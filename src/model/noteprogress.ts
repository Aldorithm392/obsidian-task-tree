// Recursive task detection across linked notes (v1.1).
//
// A board task can own a note; that note can carry its OWN checklists and link to
// deeper task-notes, which can do the same. This walks that web and reports how much
// unfinished work really sits under a task.
//
// Three commitments, deliberately:
//   • READ-ONLY and a SEPARATE signal — it never feeds computeRollup, so every file's
//     state stays recomputable from that file alone.
//   • The caller supplies the reader, so this module stays pure (no Obsidian import)
//     and testable under Node; at runtime the reader is Obsidian's metadata cache.
//   • Bounded: visited-set cycle guard + depth cap + a hard note budget, so a
//     pathological link web can never stall a render.

import type { Role } from "./types.ts";

/** What one task-note contributes to the walk. */
export interface NoteSnapshot {
	/** Roles of the checklist items in the note body, in document order. */
	roles: Role[];
	/**
	 * Paths of notes this one links to that the caller has ALREADY confirmed are
	 * task-notes (`type: task-note`). That gate is the caller's job — this module
	 * never decides which files are in scope.
	 */
	links: string[];
}

/** The depth signal for one board task. Read-only; never feeds roll-up. */
export interface NoteProgress {
	/** Checklist items finished across the task's note and every task-note below it. */
	done: number;
	/** Checklist items that count (cancelled ones are excluded, as in roll-up). */
	total: number;
	/** Notes that contributed — the task's own note counts as 1. */
	notes: number;
	/** Deepest note level reached: 1 = the task's own note only. */
	depth: number;
	/** True when the depth cap or the note budget cut the walk short — "there is more below". */
	truncated: boolean;
}

export interface NoteWalkOptions {
	/** How many note levels to follow. 1 = the task's own note only. */
	maxDepth: number;
	/** Hard ceiling on notes visited for one task. */
	maxNotes?: number;
}

/** Deliberately generous: a real project nests a few levels, not two hundred. */
export const DEFAULT_MAX_NOTES = 200;

/**
 * Walk the task-note web from `rootPath`, breadth-first, and roll the checklist
 * counts up. Returns null when the root note doesn't resolve (no badge to show).
 *
 * `read` returns null for anything out of scope; a note already visited is never
 * read twice, which is what makes cycles and diamonds safe.
 */
export function walkNoteProgress(
	rootPath: string,
	read: (path: string) => NoteSnapshot | null,
	opts: NoteWalkOptions,
): NoteProgress | null {
	const maxDepth = Math.max(1, Math.floor(opts.maxDepth));
	const maxNotes = Math.max(1, Math.floor(opts.maxNotes ?? DEFAULT_MAX_NOTES));

	const root = read(rootPath);
	if (!root) return null;

	const visited = new Set<string>([rootPath]);
	let frontier: NoteSnapshot[] = [root];
	let done = 0;
	let total = 0;
	let notes = 0;
	let depth = 0;
	let truncated = false;

	for (let level = 1; level <= maxDepth && frontier.length > 0; level++) {
		depth = level;
		const next: NoteSnapshot[] = [];
		for (const snap of frontier) {
			notes += 1;
			for (const role of snap.roles) {
				// Same rule as roll-up: a cancelled item is out of the denominator.
				if (role === "cancelled") continue;
				total += 1;
				if (role === "done") done += 1;
			}
			for (const link of snap.links) {
				if (visited.has(link)) continue; // cycle / diamond guard
				if (level === maxDepth) {
					truncated = true; // there IS more below, we just stop here
					continue;
				}
				visited.add(link);
				if (visited.size > maxNotes) {
					truncated = true;
					continue;
				}
				const snapshot = read(link);
				if (snapshot) next.push(snapshot);
			}
		}
		frontier = next;
	}

	return { done, total, notes, depth, truncated };
}

/** Unfinished checklist work below a task: what the badge and the panel care about. */
export function pendingNoteWork(progress: NoteProgress | undefined): number {
	if (!progress) return 0;
	return Math.max(0, progress.total - progress.done);
}
