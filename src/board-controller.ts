import { Notice, TFile, normalizePath, type App } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import type { ColumnDef, RollupOptions, TaskNode } from "./model/types.ts";
import { buildTree, flatten } from "./model/parser.ts";
import { computeRollup } from "./model/rollup.ts";
import { markBlockedPaths, resolveEdges, type EdgeGraph } from "./model/insights.ts";
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
	setBlockedByInText,
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
	/** Same-board dependency edges (tt-blocked-by), with unresolved ids and cycles. */
	graph: EdgeGraph;
	/** First body line (after the YAML frontmatter). */
	bodyStart: number;
	/** The indentation this file actually uses for one level — detected, so edits match the file, not the settings. */
	indentUnit: string;
}

export async function loadBoard(plugin: TaskTreePlugin, file: TFile): Promise<BoardModel> {
	const { app, settings } = plugin;
	const text = await app.vault.cachedRead(file);
	const cache = app.metadataCache.getFileCache(file);
	const fm = (cache?.frontmatter ?? undefined);
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
	const graph = resolveEdges(roots);

	// Resolve each task's OWN note (the trailing [[link]], verified against the linked
	// file's `type: task-note` frontmatter) so views can de-duplicate the visible title.
	for (const n of flatten(roots)) {
		if (!n.isTask) continue;
		const link = lastWikilink(n.text);
		if (link && resolveTaskNote(plugin, file.path, n)) n.ownNoteLink = link;
	}

	// One indentation level = the whitespace a child adds on top of its PARENT's indent
	// (not a child's full leading whitespace — a root could itself be indented). Detected
	// so moves/inserts match the file's own style (tabs vs N spaces), not the global setting.
	const nodes = flatten(roots);
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	let indentUnit = getIndentUnit(settings);
	for (const n of nodes) {
		if (!n.parentId) continue;
		const p = nodeById.get(n.parentId);
		if (p && n.indentText.length > p.indentText.length && n.indentText.startsWith(p.indentText)) {
			indentUnit = n.indentText.slice(p.indentText.length);
			break;
		}
	}

	return { file, lines, roots, columns, rollupOpts, graph, bodyStart: frontmatterEndLine(lines), indentUnit };
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

/** Replace a task's dependency list (`tt-blocked-by`); an empty list clears the field. */
export async function writeBlockedBy(
	plugin: TaskTreePlugin,
	file: TFile,
	line: number,
	ids: string[],
): Promise<void> {
	await plugin.app.vault.process(file, (d) => setBlockedByInText(d, line, ids));
	await touch(plugin, file);
}

export async function moveNode(
	plugin: TaskTreePlugin,
	file: TFile,
	opts: MoveSubtreeOptions,
	movedId?: string,
): Promise<void> {
	let changed = false;
	await plugin.app.vault.process(file, (d) => {
		const next = moveSubtreeInText(d, opts);
		changed = next !== d;
		return next;
	});
	if (!changed) return; // a no-op move (dropped in place) shouldn't touch or queue anything
	// The moved subtree's position changed → its task-notes' frontmatter is now stale.
	// Queue a resync that runs once the board's metadata cache reflects the new tree.
	if (movedId) plugin.queueNoteSync(file.path, movedId);
	await touch(plugin, file);
}

// ---- CRUD (dashboard editing) ----------------------------------------------

const NEW_TASK_TEXT = "New task";

/** Each add* returns the LINE the new task landed on, so a view can drop straight into editing it. */
export async function addChildTask(plugin: TaskTreePlugin, model: BoardModel, parent: TaskNode): Promise<number> {
	const indent = parent.indentText + model.indentUnit; // one more level, in the file's own style
	await plugin.app.vault.process(model.file, (d) =>
		insertTaskInText(d, parent.lastDescLine, indent, NEW_TASK_TEXT),
	);
	await touch(plugin, model.file);
	return parent.lastDescLine + 1;
}

export async function addSiblingTask(plugin: TaskTreePlugin, model: BoardModel, node: TaskNode): Promise<number> {
	await plugin.app.vault.process(model.file, (d) =>
		insertTaskInText(d, node.lastDescLine, node.indentText, NEW_TASK_TEXT),
	);
	await touch(plugin, model.file);
	return node.lastDescLine + 1;
}

export async function addRootTask(plugin: TaskTreePlugin, model: BoardModel): Promise<number> {
	const lastRoot = model.roots[model.roots.length - 1];
	const after = lastRoot ? lastRoot.lastDescLine : model.bodyStart - 1;
	await plugin.app.vault.process(model.file, (d) => insertTaskInText(d, after, "", NEW_TASK_TEXT));
	await touch(plugin, model.file);
	return after + 1;
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

/**
 * First `<base>.md` in `folder` that doesn't collide with an existing file — suffixing
 * " 2", " 3", … until free. `keep` (a full path) never counts as a collision, so a file
 * being renamed can keep its own name.
 */
function uniquePath(app: App, folder: string, base: string, keep?: string): { name: string; path: string } {
	let name = base;
	let path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	let n = 2;
	while (path !== keep && app.vault.getAbstractFileByPath(path)) {
		name = `${base} ${n++}`;
		path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	}
	return { name, path };
}

/**
 * YAML `title` = note title: renaming the board renames the file too, via
 * `fileManager.renameFile` so every inbound [[link]] is rewritten. The title write
 * always lands; a failed file rename reports and leaves the note where it was.
 */
export async function renameBoard(plugin: TaskTreePlugin, file: TFile, title: string): Promise<void> {
	await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		fm["title"] = title;
	});

	const base = sanitizeFileName(cleanTitle(title));
	if (!base || base === file.basename) return; // unnameable or already matching — title-only rename

	const parentPath = file.parent?.path ?? "";
	const folder = parentPath === "/" ? "" : parentPath; // rename ≠ move: stay in the file's folder
	const { path } = uniquePath(plugin.app, folder, base, file.path);
	try {
		await plugin.app.fileManager.renameFile(file, path);
	} catch (e) {
		new Notice(`Task Tree: could not rename the board file (${e instanceof Error ? e.message : String(e)})`);
	}
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
		// No body H1: the inline title / view header already carries the name.
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

	const { path } = uniquePath(app, dir, base);

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

/**
 * The TRAILING wikilink target of a task line. A task's own note is linked by the
 * `[[name]]` openOrCreateTaskNote appends at the end, so we take the LAST link — never
 * a cross-reference to another task earlier in the same line.
 */
function lastWikilink(text: string): string | null {
	const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
	let last: string | null = null;
	for (let m = re.exec(text); m; m = re.exec(text)) last = m[1] ?? null;
	return last ? last.trim() : null;
}

function cleanTitle(text: string): string {
	return text.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
}

/** The self-describing frontmatter + body for a task's own note (an OKF concept). */
function taskNoteContent(node: TaskNode, meta: TaskNoteMeta, boardName: string, noteName: string): string {
	// Use the same stripLinks + the same field shapes as syncTaskNotesForMove, so a
	// freshly-created note and a re-synced one are byte-identical. JSON-encode the string
	// values so a colon/quote/bracket in a title can't break the YAML.
	const title = stripLinks(node.text) || noteName;
	const lines = [
		"---",
		"type: task-note",
		`title: ${JSON.stringify(title)}`,
		`board: "[[${boardName}]]"`,
		`parent: ${JSON.stringify(meta.parentText ? stripLinks(meta.parentText) : "(root)")}`,
		`depth: ${meta.depth}`,
		`distance_to_main: ${meta.depth}`,
		`path: ${JSON.stringify([...meta.path.map(stripLinks), title].join(" / "))}`,
	];
	if (node.hasStoredId) lines.push(`task_id: ${node.id}`);
	// No body H1: Obsidian's inline title already shows the note name — an H1 would
	// render the title twice, stacked. The frontmatter `title` carries it for agents.
	lines.push("---", "", "## Progress", "", "## Status", "", "## Notes", "");
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
	const linked = lastWikilink(node.text);
	if (linked) {
		await app.workspace.openLinkText(linked, model.file.path, true);
		return;
	}

	const parentPath = model.file.parent?.path ?? "";
	const boardFolder = parentPath === "/" ? "" : parentPath;
	const folder = plugin.settings.taskNoteFolder.trim() || boardFolder;
	const base = sanitizeFileName(cleanTitle(node.text)) || node.id;

	const { name, path } = uniquePath(app, folder, base);

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

/** The task-note a task links to — but only if it is actually THIS task's own note. */
function resolveTaskNote(plugin: TaskTreePlugin, sourcePath: string, node: TaskNode): TFile | null {
	const link = lastWikilink(node.text);
	if (!link) return null;
	const dest = plugin.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
	if (!(dest instanceof TFile)) return null;
	const fm = plugin.app.metadataCache.getFileCache(dest)?.frontmatter;
	if (fm?.["type"] !== "task-note") return null;
	// If the note records its owning task, require a match — a stray cross-reference
	// link can then never clobber a different task's note.
	if (node.hasStoredId && fm["task_id"] !== undefined && fm["task_id"] !== node.id) return null;
	return dest;
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
	let unresolved = false;
	for (const id of movedIds) {
		const node = byId.get(id);
		if (!node) {
			unresolved = true; // a position-keyed (id-less) task the move renumbered
			continue;
		}
		for (const n of flatten([node])) subtree.set(n.id, n);
	}

	// If an id couldn't be resolved, we can't know which subtree moved — refresh every
	// task-note so none is left stale. (Only notes that actually exist are written.)
	const targets = unresolved ? [...byId.values()] : [...subtree.values()];

	// Resolve first, and record every task that claims each note. A note claimed by more
	// than one task is ambiguous (e.g. two tasks share a trailing link, no task_id) —
	// skip it rather than let document order silently pick a winner.
	const claims = new Map<string, TaskNode[]>();
	const notes = new Map<string, TFile>();
	for (const n of targets) {
		if (!n.isTask) continue;
		const note = resolveTaskNote(plugin, file.path, n);
		if (!note) continue;
		notes.set(note.path, note);
		(claims.get(note.path) ?? claims.set(note.path, []).get(note.path)!).push(n);
	}

	for (const [path, owners] of claims) {
		if (owners.length !== 1) continue; // ambiguous ownership — leave it alone
		const n = owners[0]!;
		const note = notes.get(path)!;
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
