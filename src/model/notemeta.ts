// The single source of truth for a task-note's structural frontmatter: what the
// plugin writes at creation, what it reconciles toward afterwards. Pure — the
// controller supplies titles already stripped of [[links]].

export interface NoteMetaInput {
	/** The task's clean title (links stripped; falls back to the note name upstream). */
	title: string;
	/** Direct parent's clean title, or null for a root task. */
	parentTitle: string | null;
	/** The board note's basename (link target). */
	boardName: string;
}

/**
 * The structural fields a task-note's frontmatter is expected to carry.
 *
 * Deliberately small. `depth`, `distance_to_main` and `path` used to live here too, and
 * they were the third commitment inverted: pure derivations of the board, written into
 * files the plugin doesn't own, kept true only by a background reconcile. Delete the
 * plugin and they don't vanish — they start lying, silently, forever. (`distance_to_main`
 * was also literally `depth` under a second name, in every user note and in the agent
 * contract.) An agent that wants a task's depth reads the board, where it is a fact
 * rather than a copy.
 *
 * What survives is what a note cannot derive from itself: which board it belongs to,
 * which task it is, and its parent — an edge, not a measurement.
 */
export interface ExpectedNoteFields {
	title: string;
	parent: string;
}

/** Keys the plugin used to write and now removes on the next reconcile of each note. */
export const RETIRED_NOTE_FIELDS = ["depth", "distance_to_main", "path"] as const;

export function expectedNoteFields(m: NoteMetaInput): ExpectedNoteFields {
	return {
		title: m.title,
		parent: m.parentTitle ?? "(root)",
	};
}

/**
 * Retired keys still present in a note's frontmatter. Stopping the reconcile is not
 * enough on its own: the keys already written would simply rot in place, with nothing
 * marking them stale — which is worse than maintaining them. They have to be removed.
 */
export function retiredFieldsPresent(cached: Record<string, unknown> | undefined): string[] {
	if (!cached) return [];
	return RETIRED_NOTE_FIELDS.filter((k) => k in cached);
}

/**
 * Which structural keys of a note's cached frontmatter drifted from the expected
 * values. The `board` link is deliberately NOT string-compared here — a moved or
 * rewritten link can differ textually yet still resolve; the controller checks it
 * by resolution instead.
 */
export function noteFieldsDrift(
	cached: Record<string, unknown> | undefined,
	expected: ExpectedNoteFields,
): string[] {
	if (!cached) return Object.keys(expected);
	const drift: string[] = [];
	for (const [k, v] of Object.entries(expected)) {
		if (cached[k] !== v) drift.push(k);
	}
	return drift;
}
