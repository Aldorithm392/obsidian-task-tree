import { TFile } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import type { ColumnDef, RollupOptions, TaskNode } from "./model/types.ts";
import { buildTree } from "./model/parser.ts";
import { computeRollup } from "./model/rollup.ts";
import { markBlockedPaths } from "./model/insights.ts";
import { columnsFromFrontmatter } from "./model/okf.ts";
import { getIndentUnit } from "./settings.ts";
import {
	addTagInText,
	assignIdsInText,
	clearOverrideInText,
	deleteRangeInText,
	frontmatterEndLine,
	insertTaskInText,
	moveSubtreeInText,
	setOverrideInText,
	setStatusInText,
	setTaskTextInText,
	type MoveSubtreeOptions,
} from "./model/writer.ts";
import type { Role } from "./model/types.ts";

/** Everything a view needs to render one board, built fresh from disk + cache. */
export interface BoardModel {
	file: TFile;
	lines: string[];
	roots: TaskNode[];
	columns: ColumnDef[];
	rollupOpts: RollupOptions;
	/** First body line (after the YAML frontmatter). */
	bodyStart: number;
}

export async function loadBoard(plugin: TaskTreePlugin, file: TFile): Promise<BoardModel> {
	const { app, settings } = plugin;
	const text = await app.vault.cachedRead(file);
	const cache = app.metadataCache.getFileCache(file);
	const fm = (cache?.frontmatter ?? undefined) as Record<string, unknown> | undefined;
	const columns = columnsFromFrontmatter(fm, settings.columns);
	const lines = text.split("\n");

	const items = (cache?.listItems ?? []).map((li) => ({
		line: li.position.start.line,
		endLine: li.position.end.line,
		task: li.task,
		blockId: li.id,
		parent: li.parent,
	}));

	const rollupOpts: RollupOptions = {
		unknownRole: settings.unknownRole,
		blockedDominates: settings.blockedDominates,
	};

	const roots = buildTree(items, lines, { columns, unknownRole: settings.unknownRole });
	computeRollup(roots, rollupOpts);
	markBlockedPaths(roots);

	return { file, lines, roots, columns, rollupOpts, bodyStart: frontmatterEndLine(lines) };
}

/** Assign a stable ^id to every task that lacks one. Returns true if it wrote. */
export async function ensureIds(plugin: TaskTreePlugin, file: TFile): Promise<boolean> {
	if (!plugin.settings.autoAssignIds) return false;
	let assigned = 0;
	await plugin.app.vault.process(file, (data) => {
		const res = assignIdsInText(data, {
			prefix: plugin.settings.idPrefix,
			length: plugin.settings.idLength,
		});
		assigned = res.assigned;
		return res.text;
	});
	return assigned > 0;
}

export async function writeStatus(
	plugin: TaskTreePlugin,
	file: TFile,
	line: number,
	status: string,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => setStatusInText(d, line, status));
	await touch(plugin, file);
}

export async function writeOverride(
	plugin: TaskTreePlugin,
	file: TFile,
	line: number,
	role: Role,
	columns: ColumnDef[],
): Promise<void> {
	await plugin.app.vault.process(file, (d) => setOverrideInText(d, line, role, columns));
	await touch(plugin, file);
}

export async function clearOverride(
	plugin: TaskTreePlugin,
	file: TFile,
	line: number,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => clearOverrideInText(d, line));
	await touch(plugin, file);
}

export async function moveNode(
	plugin: TaskTreePlugin,
	file: TFile,
	opts: MoveSubtreeOptions,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => moveSubtreeInText(d, opts));
	await touch(plugin, file);
}

// ---- CRUD (dashboard editing) ----------------------------------------------

const NEW_TASK_TEXT = "New task";

export async function addChildTask(plugin: TaskTreePlugin, file: TFile, parent: TaskNode): Promise<void> {
	const indent = parent.indentText + getIndentUnit(plugin.settings);
	await plugin.app.vault.process(file, (d) =>
		insertTaskInText(d, parent.lastDescLine, indent, NEW_TASK_TEXT),
	);
	await touch(plugin, file);
}

export async function addSiblingTask(plugin: TaskTreePlugin, file: TFile, node: TaskNode): Promise<void> {
	await plugin.app.vault.process(file, (d) =>
		insertTaskInText(d, node.lastDescLine, node.indentText, NEW_TASK_TEXT),
	);
	await touch(plugin, file);
}

export async function addRootTask(plugin: TaskTreePlugin, file: TFile, model: BoardModel): Promise<void> {
	const lastRoot = model.roots[model.roots.length - 1];
	const after = lastRoot ? lastRoot.lastDescLine : model.bodyStart - 1;
	await plugin.app.vault.process(file, (d) => insertTaskInText(d, after, "", NEW_TASK_TEXT));
	await touch(plugin, file);
}

export async function deleteTask(plugin: TaskTreePlugin, file: TFile, node: TaskNode): Promise<void> {
	await plugin.app.vault.process(file, (d) => deleteRangeInText(d, node.line, node.lastDescLine));
	await touch(plugin, file);
}

export async function renameTask(
	plugin: TaskTreePlugin,
	file: TFile,
	node: TaskNode,
	text: string,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => setTaskTextInText(d, node.line, text));
	await touch(plugin, file);
}

export async function addTagTask(
	plugin: TaskTreePlugin,
	file: TFile,
	node: TaskNode,
	tag: string,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => addTagInText(d, node.line, tag));
	await touch(plugin, file);
}

export async function renameBoard(plugin: TaskTreePlugin, file: TFile, title: string): Promise<void> {
	await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		fm["title"] = title;
	});
}

async function touch(plugin: TaskTreePlugin, file: TFile): Promise<void> {
	if (!plugin.settings.maintainTimestamp) return;
	try {
		await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm["timestamp"] = new Date().toISOString();
		});
	} catch {
		// non-fatal: a timestamp update should never block a real edit
	}
}
