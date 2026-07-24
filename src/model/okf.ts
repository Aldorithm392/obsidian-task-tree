// Open Knowledge Format (OKF) helpers. Pure: takes plain frontmatter objects, so
// it stays testable and free of the Obsidian runtime.

import type { ColumnDef, Role } from "./types.ts";
import { ALL_ROLES } from "./types.ts";

/** The OKF `type` value that opts a file in to Task Tree management. */
export const MANAGED_TYPE = "task-tree";

/** A file is managed only when its frontmatter declares `type: task-tree`. */
export function isManagedFrontmatter(fm: Record<string, unknown> | undefined | null): boolean {
	return !!fm && fm["type"] === MANAGED_TYPE;
}

function slug(name: string): string {
	const s = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return s || "col";
}

/**
 * Read a per-board column set from `tt_columns` frontmatter, falling back to the
 * vault default when absent or malformed. Entry shape: `{ name, status, role }`.
 */
export function columnsFromFrontmatter(
	fm: Record<string, unknown> | undefined | null,
	fallback: ColumnDef[],
): ColumnDef[] {
	const raw = fm ? fm["tt_columns"] : undefined;
	if (!Array.isArray(raw)) return fallback;

	const cols: ColumnDef[] = [];
	const usedIds = new Set<string>();
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		const name = typeof e["name"] === "string" ? (e["name"]) : "";
		const status = typeof e["status"] === "string" ? (e["status"]) : "";
		const roleStr = typeof e["role"] === "string" ? (e["role"]).toLowerCase() : "";
		if (!name || [...status].length !== 1 || !(ALL_ROLES as string[]).includes(roleStr)) continue;
		let id = slug(name);
		while (usedIds.has(id)) id += "-2";
		usedIds.add(id);
		const col: ColumnDef = { id, name, status, role: roleStr as Role };
		if (typeof e["color"] === "string" && e["color"]) col.color = e["color"];
		const wip = e["wipLimit"];
		if (typeof wip === "number" && Number.isFinite(wip) && wip > 0) col.wipLimit = Math.floor(wip);
		cols.push(col);
	}
	return cols.length ? cols : fallback;
}

export interface BundleEntry {
	/** Path relative to the index file, e.g. "projects/website-redesign.md". */
	path: string;
	title: string;
	description?: string;
}

/** Build an OKF `index.md` (a directory listing; OKF forbids frontmatter here). */
export function buildIndexMd(entries: BundleEntry[], heading = "Projects"): string {
	const lines: string[] = [`# ${heading}`, ""];
	for (const e of entries) {
		const desc = e.description ? ` - ${e.description}` : "";
		lines.push(`* [${e.title}](${e.path})${desc}`);
	}
	return lines.join("\n") + "\n";
}

/** Prepend a dated entry to an OKF `log.md` (newest first). */
export function appendLogEntry(existing: string, dateISO: string, entry: string): string {
	const heading = `## ${dateISO}`;
	const bullet = `* ${entry}`;
	const trimmed = existing.trimEnd();
	if (trimmed.includes(heading)) {
		// Insert under the existing date heading.
		const idx = trimmed.indexOf(heading) + heading.length;
		return trimmed.slice(0, idx) + "\n" + bullet + trimmed.slice(idx) + "\n";
	}
	const header = trimmed.startsWith("#") ? "" : "# Update Log\n\n";
	const body = trimmed.startsWith("# ")
		? trimmed.replace(/^(# .*\n)/, `$1\n${heading}\n${bullet}\n`)
		: `${header}${heading}\n${bullet}\n\n${trimmed}`;
	return body.trimEnd() + "\n";
}
