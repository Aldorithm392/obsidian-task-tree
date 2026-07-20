import { TFile } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import type { ColumnDef, RollupOptions, TaskNode } from "./model/types.ts";
import { buildTree, flatten } from "./model/parser.ts";
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
	/** The indentation this file actually uses for one level — detected, so edits match the file, not the settings. */
	indentUnit: string;
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

	// One depth-1 node's leading whitespace IS one indentation level in this file.
	// Use it so moves/inserts match the file's own style (tabs vs N spaces), not the
	// global setting — a mismatch silently corrupts nesting when re-indenting.
	const oneLevel = flatten(roots).find((n) => n.depth === 1 && n.indentText.length > 0);
	const indentUnit = oneLevel ? oneLevel.indentText : getIndentUnit(settings);

	return { file, lines, roots, columns, rollupOpts, bodyStart: frontmatterEndLine(lines), indentUnit };
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
	movedId?: string,
): Promise<void> {
	await plugin.app.vault.process(file, (d) => moveSubtreeInText(d, opts));
	// The moved subtree's position changed → its task-notes' frontmatter is now stale.
	// Queue a resync that runs once the board's metadata cache reflects the new tree.
	if (movedId) plugin.queueNoteSync(file.path, movedId);
	await touch(plugin, file);
}

// ---- CRUD (dashboard editing) ----------------------------------------------

const NEW_TASK_TEXT = "New task";

export async function addChildTask(plugin: TaskTreePlugin, model: BoardModel, parent: TaskNode): Promise<void> {
	const indent = parent.indentText + model.indentUnit; // one more level, in the file's own style
	await plugin.app.vault.process(model.file, (d) =>
		insertTaskInText(d, parent.lastDescLine, indent, NEW_TASK_TEXT),
	);
	await touch(plugin, model.file);
}

export async function addSiblingTask(plugin: TaskTreePlugin, model: BoardModel, node: TaskNode): Promise<void> {
	await plugin.app.vault.process(model.file, (d) =>
		insertTaskInText(d, node.lastDescLine, node.indentText, NEW_TASK_TEXT),
	);
	await touch(plugin, model.file);
}

export async function addRootTask(plugin: TaskTreePlugin, model: BoardModel): Promise<void> {
	const lastRoot = model.roots[model.roots.length - 1];
	const after = lastRoot ? lastRoot.lastDescLine : model.bodyStart - 1;
	await plugin.app.vault.process(model.file, (d) => insertTaskInText(d, after, "", NEW_TASK_TEXT));
	await touch(plugin, model.file);
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

/** Body of a brand-new board: managed frontmatter + a couple of starter tasks to show the shape. */
function boardFileContent(title: string, unit: string): string {
	return [
		"---",
		"type: task-tree",
		// JSON-encode so a title with a colon/quote stays valid YAML.
		`title: ${JSON.stringify(title)}`,
		"---",
		"",
		`# ${title}`,
		"",
		"- [ ] First task",
		`${unit}- [ ] A subtask`,
		"- [ ] Second task",
		"",
	].join("\n");
}

/** Create a new Markdown note that is already a Task Tree board, in `folder` (empty = vault root). */
export async function createBoardFile(plugin: TaskTreePlugin, title: string, folder: string): Promise<TFile> {
	const { app } = plugin;
	const base = sanitizeFileName(cleanTitle(title)) || "Untitled board";
	const dir = folder.trim().replace(/^\/+|\/+$/g, "");

	let name = base;
	let path = dir ? `${dir}/${name}.md` : `${name}.md`;
	let n = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		name = `${base} ${n++}`;
		path = dir ? `${dir}/${name}.md` : `${name}.md`;
	}

	if (dir && !app.vault.getAbstractFileByPath(dir)) {
		try {
			await app.vault.createFolder(dir);
		} catch {
			// already exists / race — ignore
		}
	}

	return app.vault.create(path, boardFileContent(title, getIndentUnit(plugin.settings)));
}

// ---- task = note -----------------------------------------------------------

export interface TaskNoteMeta {
	/** Depth in the tree (0 = root). Also the distance to the main task. */
	depth: number;
	/** Ancestor texts, root-most first (excludes the node itself). */
	path: string[];
	parentText: string | null;
}

const FILE_UNSAFE = /[\\/:*?"<>|#^[\]]/g;
function sanitizeFileName(name: string): string {
	return name.replace(FILE_UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/;

function cleanTitle(text: string): string {
	return text.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
}

/** The self-describing frontmatter + body for a task's own note (an OKF concept). */
function taskNoteContent(node: TaskNode, meta: TaskNoteMeta, boardName: string, noteName: string): string {
	const title = cleanTitle(node.text) || noteName;
	const lines = [
		"---",
		"type: task-note",
		`title: ${title}`,
		`board: "[[${boardName}]]"`,
		`parent: ${meta.parentText ? cleanTitle(meta.parentText) : "(root)"}`,
		`depth: ${meta.depth}`,
		`distance_to_main: ${meta.depth}`,
		`path: ${[...meta.path.map(cleanTitle), title].join(" / ")}`,
	];
	if (node.hasStoredId) lines.push(`task_id: ${node.id}`);
	lines.push("---", "", `# ${title}`, "", "## Progress", "", "## Status", "", "## Notes", "");
	return lines.join("\n");
}

/**
 * Open the task's own note, creating it (with structural frontmatter) and linking the task to it
 * if it doesn't have one yet. This is the "task = note" feature.
 */
export async function openOrCreateTaskNote(
	plugin: TaskTreePlugin,
	model: BoardModel,
	node: TaskNode,
	meta: TaskNoteMeta,
): Promise<void> {
	const { app } = plugin;

	// Already linked → just open it (Obsidian creates it if missing).
	const linked = WIKILINK_RE.exec(node.text);
	if (linked && linked[1]) {
		await app.workspace.openLinkText(linked[1].trim(), model.file.path, true);
		return;
	}

	const parentPath = model.file.parent?.path ?? "";
	const boardFolder = parentPath === "/" ? "" : parentPath;
	const folder = plugin.settings.taskNoteFolder.trim() || boardFolder;
	const base = sanitizeFileName(cleanTitle(node.text)) || node.id;

	let name = base;
	let path = folder ? `${folder}/${name}.md` : `${name}.md`;
	let n = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		name = `${base} ${n++}`;
		path = folder ? `${folder}/${name}.md` : `${name}.md`;
	}

	if (folder && !app.vault.getAbstractFileByPath(folder)) {
		try {
			await app.vault.createFolder(folder);
		} catch {
			// already exists / race — ignore
		}
	}

	const created = await app.vault.create(path, taskNoteContent(node, meta, model.file.basename, name));
	await app.vault.process(model.file, (d) => setTaskTextInText(d, node.line, `${node.text} [[${name}]]`));
	await touch(plugin, model.file);
	await app.workspace.getLeaf("tab").openFile(created);
}

/** A task's human title: its line text with any [[wikilink]] removed and whitespace collapsed. */
function stripLinks(text: string): string {
	return text.replace(/\[\[[^\]]*\]\]/g, "").replace(/\s+/g, " ").trim();
}

/** The task-note a task links to — but only if it is actually one of our task-notes. */
function resolveTaskNote(plugin: TaskTreePlugin, sourcePath: string, node: TaskNode): TFile | null {
	const m = WIKILINK_RE.exec(node.text);
	if (!m || !m[1]) return null;
	const dest = plugin.app.metadataCache.getFirstLinkpathDest(m[1].trim(), sourcePath);
	if (!(dest instanceof TFile)) return null;
	const type = plugin.app.metadataCache.getFileCache(dest)?.frontmatter?.["type"];
	return type === "task-note" ? dest : null;
}

function nodeMeta(node: TaskNode, byId: Map<string, TaskNode>): TaskNoteMeta {
	const path: string[] = [];
	let pid = node.parentId;
	let guard = 0;
	while (pid && guard++ < 50) {
		const p = byId.get(pid);
		if (!p) break;
		path.unshift(p.text);
		pid = p.parentId;
	}
	const parent = node.parentId ? byId.get(node.parentId) : undefined;
	return { depth: node.depth, path, parentText: parent ? parent.text : null };
}

/**
 * After a structural move, refresh the self-describing frontmatter (parent / depth /
 * distance_to_main / path) of every task-note inside the moved subtree, so an agent
 * reading the note still sees where the task sits. Runs on fresh, post-move data.
 */
export async function syncTaskNotesForMove(
	plugin: TaskTreePlugin,
	file: TFile,
	movedIds: string[],
): Promise<void> {
	if (!plugin.settings.updateTaskNoteFrontmatter) return;
	const model = await loadBoard(plugin, file);
	const byId = new Map(flatten(model.roots).map((n) => [n.id, n]));

	const subtree = new Map<string, TaskNode>();
	for (const id of movedIds) {
		const node = byId.get(id);
		if (!node) continue;
		for (const n of flatten([node])) subtree.set(n.id, n);
	}

	for (const n of subtree.values()) {
		if (!n.isTask) continue;
		const note = resolveTaskNote(plugin, file.path, n);
		if (!note) continue;
		const meta = nodeMeta(n, byId);
		const title = stripLinks(n.text) || note.basename;
		await plugin.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
			fm["parent"] = meta.parentText ? stripLinks(meta.parentText) : "(root)";
			fm["depth"] = meta.depth;
			fm["distance_to_main"] = meta.depth;
			fm["path"] = [...meta.path.map(stripLinks), title].join(" / ");
		});
	}
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
