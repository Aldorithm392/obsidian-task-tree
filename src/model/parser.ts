import type { ColumnDef, RawListItem, Role, TaskNode } from "./types.ts";
import { parseLine } from "./line.ts";
import { resolveStatus } from "../columns.ts";

export interface ParseOptions {
	columns: ColumnDef[];
	unknownRole: Role;
}

/**
 * Build a task tree from a flat list of items (projected from Obsidian's
 * `listItems` cache) plus the raw file lines. Pure and deterministic.
 *
 * Obsidian's `parent` field is the line number of the parent list item when
 * >= 0, and the negative of the list's first line when the item is top-level.
 * We therefore treat any `parent < 0` (or a parent line we don't recognize) as
 * a root, and otherwise attach to the node whose line equals `parent`.
 */
export function buildTree(items: RawListItem[], lines: string[], opts: ParseOptions): TaskNode[] {
	const byLine = new Map<number, TaskNode>();

	for (const it of items) {
		const raw = lines[it.line] ?? "";
		const p = parseLine(raw);
		const statusChar = it.task !== undefined ? it.task : p.statusChar;
		const isTask = it.task !== undefined || p.isTask;
		const storedId = p.blockId ?? it.blockId;
		const resolved = isTask
			? resolveStatus(statusChar, opts.columns, opts.unknownRole)
			: { role: "todo" as Role, mapped: true };

		byLine.set(it.line, {
			id: storedId ?? `L${it.line}`,
			hasStoredId: storedId !== undefined,
			line: it.line,
			endLine: it.endLine,
			lastDescLine: it.endLine,
			depth: 0,
			indentText: p.indentText,
			marker: p.marker || "-",
			statusChar: statusChar === "" ? " " : statusChar,
			isTask,
			text: p.text,
			override: p.override,
			blockedBy: p.blockedBy ?? [],
			literalRole: resolved.role,
			statusMapped: resolved.mapped,
			derivedRole: "todo",
			effectiveRole: "todo",
			progress: { done: 0, total: 0 },
			parentId: null,
			children: [],
			isLeaf: true,
		});
	}

	const roots: TaskNode[] = [];
	for (const it of items) {
		const node = byLine.get(it.line);
		if (!node) continue;
		const parent = it.parent >= 0 ? byLine.get(it.parent) : undefined;
		// Attach only to a genuine ancestor: a different item, earlier in the file,
		// with strictly less indentation. This also sidesteps Obsidian's `-0` root
		// encoding when a list happens to start on line 0.
		if (
			parent &&
			parent !== node &&
			parent.line < node.line &&
			parent.indentText.length < node.indentText.length
		) {
			parent.children.push(node);
			node.parentId = parent.id;
		} else {
			roots.push(node);
		}
	}

	for (const r of roots) assignDepthAndExtent(r, 0);
	return roots;
}

function assignDepthAndExtent(node: TaskNode, depth: number): void {
	node.depth = depth;
	node.isLeaf = node.children.length === 0;
	let last = node.endLine;
	for (const child of node.children) {
		assignDepthAndExtent(child, depth + 1);
		if (child.lastDescLine > last) last = child.lastDescLine;
	}
	node.lastDescLine = last;
}

/** Depth-first flatten in document order (parents before their children). */
export function flatten(roots: TaskNode[]): TaskNode[] {
	const out: TaskNode[] = [];
	const walk = (n: TaskNode): void => {
		out.push(n);
		for (const c of n.children) walk(c);
	};
	for (const r of roots) walk(r);
	return out;
}

/** Find a node by id anywhere in the tree. */
export function findById(roots: TaskNode[], id: string): TaskNode | undefined {
	return flatten(roots).find((n) => n.id === id);
}
