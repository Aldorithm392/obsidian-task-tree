// Core data types for Task Tree. This module is pure (no Obsidian import) so the
// logic that depends on it can be unit-tested outside the Obsidian runtime.

import type { NoteProgress } from "./noteprogress.ts";

/**
 * The stable semantic layer. Column names and status characters are user-configurable,
 * but roll-up and overrides always reason about *roles*, never raw characters.
 */
export type Role = "todo" | "doing" | "done" | "cancelled" | "blocked";

export const ALL_ROLES: Role[] = ["todo", "doing", "done", "cancelled", "blocked"];

/** How the Tree view lays out the hierarchy. */
export type TreeLayout = "list" | "diagram" | "columns";

export const ALL_TREE_LAYOUTS: TreeLayout[] = ["list", "diagram", "columns"];

/** One Kanban column, mapped to exactly one checkbox status character. */
export interface ColumnDef {
	/** Stable slug, e.g. "todo". */
	id: string;
	/** Display name, e.g. "To Do". */
	name: string;
	/** The single character inside the checkbox brackets, e.g. " " or "/". */
	status: string;
	/** The semantic role this column represents. */
	role: Role;
	/** Optional accent color (any CSS color). */
	color?: string;
	/** Optional work-in-progress limit (soft, advisory). */
	wipLimit?: number;
}

/**
 * A minimal projection of Obsidian's `ListItemCache`. Keeping the parser to this
 * shape means it never touches the Obsidian API and stays testable.
 */
export interface RawListItem {
	/** position.start.line (0-based). */
	line: number;
	/** position.end.line (0-based). */
	endLine: number;
	/** The character inside `[ ]`; " " means incomplete; undefined means "not a task". */
	task?: string;
	/** Block id (without the leading caret), if the cache reported one. */
	blockId?: string;
	/** Obsidian's parent encoding: >= 0 is the parent item's line; < 0 means top-level. */
	parent: number;
}

/** The result of parsing a single raw Markdown line. */
export interface ParsedLine {
	indentText: string;
	/** "-", "*", "+", or "" for a non-list line. */
	marker: string;
	/** Whether the line has a `[x]`-style checkbox. */
	isTask: boolean;
	/** The character inside the checkbox ("" when not a task). */
	statusChar: string;
	/** Display text: marker, checkbox, override field and block id stripped. */
	text: string;
	/** Role from a `[tt-override:: role]` inline field, if present. */
	override?: Role;
	/** Block ids from a `[tt-blocked-by:: id, id]` inline field, if present. */
	blockedBy?: string[];
	/** Trailing `^id` (without the caret), if present. */
	blockId?: string;
}

/** A node in the in-memory task tree. */
export interface TaskNode {
	/** Block id, or a synthetic "L<line>" key when the task has no stored id yet. */
	id: string;
	hasStoredId: boolean;
	line: number;
	endLine: number;
	/** Last physical line of the whole subtree (used to move a branch as a unit). */
	lastDescLine: number;
	depth: number;
	indentText: string;
	marker: string;
	statusChar: string;
	isTask: boolean;
	text: string;
	override?: Role;
	/** Same-board dependency edges: block ids of tasks this one is blocked by. */
	blockedBy: string[];
	/** Role of this node's own status character. */
	literalRole: Role;
	/**
	 * False when nothing claimed this task's status character — not its columns, not the
	 * published table — so `literalRole` is a fallback guess. Surfaced in the UI rather
	 * than applied silently: a character quietly meaning something it was never assigned
	 * is how a board drifts from what its author thinks it says.
	 */
	statusMapped: boolean;
	/** Roll-up over children, ignoring any override. */
	derivedRole: Role;
	/** override ?? (has task children ? derivedRole : literalRole). */
	effectiveRole: Role;
	/** Direct-child completion, e.g. done=4 total=8. total is 0 for leaves. */
	progress: { done: number; total: number };
	parentId: string | null;
	children: TaskNode[];
	isLeaf: boolean;
	/** Set by markBlockedPaths: a blocked task sits somewhere below this node. */
	hasBlockedDescendant?: boolean;
	/** Set by resolveEdges: an unfinished `tt-blocked-by` dependency holds this task up. */
	isDependencyBlocked?: boolean;
	/** Set by loadBoard: the trailing [[link]] target when it is this task's OWN note. */
	ownNoteLink?: string;
	/**
	 * Set by loadBoard: checklist work found recursively in this task's own note and the
	 * task-notes below it. A SEPARATE signal — read-only, never feeds roll-up.
	 */
	noteProgress?: NoteProgress;
}

export interface RollupOptions {
	/** Role assigned to a status character that no column claims. */
	unknownRole: Role;
	/** When true, a blocked child surfaces "blocked" to its parent. */
	blockedDominates: boolean;
}
