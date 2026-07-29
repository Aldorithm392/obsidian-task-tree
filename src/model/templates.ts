// The text the plugin GENERATES into a user's vault: a new board's starter tasks and
// a task-note's section headings. Both are settings, because the shipped defaults are
// English and a vault is written in whatever language its owner thinks in.
//
// Pure; unit-tested under Node.

export interface StarterTask {
	/** Nesting level, 0 = top level. */
	depth: number;
	text: string;
}

/**
 * Parse the starter-task template: one task per line, nesting by leading whitespace
 * (a tab, or every two spaces, is one level). Blank lines are skipped, so an empty
 * template simply means "create the board with no tasks at all".
 *
 * Depth can only ever step DOWN one level at a time — an over-indented line lands as a
 * child of the line above it, never as an orphan the parser would have to guess about.
 */
export function parseStarterTasks(spec: string): StarterTask[] {
	const out: StarterTask[] = [];
	for (const raw of spec.split("\n")) {
		const text = raw.trim();
		if (text.length === 0) continue;
		const indent = raw.slice(0, raw.length - raw.trimStart().length);
		let level = 0;
		for (const ch of indent) level += ch === "\t" ? 2 : 1; // a tab counts as one level (2 half-steps)
		const wanted = Math.floor(level / 2);
		const prev = out[out.length - 1];
		const max = prev ? prev.depth + 1 : 0;
		out.push({ depth: Math.max(0, Math.min(wanted, max)), text });
	}
	return out;
}

/** Render the starter tasks as Markdown task lines, indented in the file's own style. */
export function renderStarterTasks(spec: string, indentUnit: string): string[] {
	return parseStarterTasks(spec).map((t) => `${indentUnit.repeat(t.depth)}- [ ] ${t.text}`);
}

/**
 * Parse the task-note section template: comma- or newline-separated headings. An empty
 * template means the note is created with a body of just its frontmatter.
 */
export function parseNoteSections(spec: string): string[] {
	return spec
		.split(/[,\n]/)
		.map((s) => s.trim().replace(/^#+\s*/, "")) // tolerate a user writing "## Progress"
		.filter((s) => s.length > 0);
}

/** The `## Heading` + blank-line body a new task-note gets. */
export function renderNoteSections(spec: string): string[] {
	const out: string[] = [];
	for (const heading of parseNoteSections(spec)) out.push(`## ${heading}`, "");
	return out;
}
