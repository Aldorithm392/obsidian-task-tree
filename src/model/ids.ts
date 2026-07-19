// Stable block-id generation and extraction. Pure; safe to run under Node.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

/** Extract a trailing block id (without the caret) from a line, if any. */
export function extractBlockId(line: string): string | undefined {
	const m = BLOCK_ID_RE.exec(line);
	return m ? m[1] : undefined;
}

/** Collect every block id present in a file's lines. */
export function collectBlockIds(lines: string[]): Set<string> {
	const ids = new Set<string>();
	for (const l of lines) {
		const id = extractBlockId(l);
		if (id) ids.add(id);
	}
	return ids;
}

/**
 * Generate a fresh id not already in `existing`. `existing` is mutated to include
 * the new id so repeated calls in one pass never collide. Uses Math.random, which
 * is fine both in the plugin runtime and under Node.
 */
export function generateId(existing: Set<string>, prefix = "t-", length = 6): string {
	for (let attempt = 0; attempt < 5000; attempt++) {
		let s = "";
		for (let i = 0; i < length; i++) {
			s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
		}
		const id = prefix + s;
		if (!existing.has(id)) {
			existing.add(id);
			return id;
		}
	}
	// Extremely unlikely fallback: widen with a counter suffix.
	let counter = 0;
	let id = `${prefix}${counter}`;
	while (existing.has(id)) {
		counter += 1;
		id = `${prefix}${counter}`;
	}
	existing.add(id);
	return id;
}
