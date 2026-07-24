// The single source of truth for a task-note's structural frontmatter: what the
// plugin writes at creation, what it reconciles toward afterwards. Pure — the
// controller supplies titles already stripped of [[links]].

export interface NoteMetaInput {
	/** The task's clean title (links stripped; falls back to the note name upstream). */
	title: string;
	/** Ancestor titles, root-most first (links stripped, excludes the task itself). */
	path: string[];
	/** Direct parent's clean title, or null for a root task. */
	parentTitle: string | null;
	/** Depth in the tree (0 = root). Also the distance to the main task. */
	depth: number;
	/** The board note's basename (link target). */
	boardName: string;
}

/** The structural fields a task-note's frontmatter is expected to carry. */
export interface ExpectedNoteFields {
	title: string;
	parent: string;
	depth: number;
	distance_to_main: number;
	path: string;
}

export function expectedNoteFields(m: NoteMetaInput): ExpectedNoteFields {
	return {
		title: m.title,
		parent: m.parentTitle ?? "(root)",
		depth: m.depth,
		distance_to_main: m.depth,
		path: [...m.path, m.title].join(" / "),
	};
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
