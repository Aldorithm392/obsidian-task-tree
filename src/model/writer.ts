import type { ColumnDef, Role } from "./types.ts";
import { parseLine } from "./line.ts";
import { canonicalStatusForRole } from "../columns.ts";
import { collectBlockIds, generateId } from "./ids.ts";

// Matches the leading marker + checkbox on a task line, capturing the marker/prefix
// and the closing bracket so the single status character can be swapped in place.
const STATUS_RE = /^(\s*[-*+]\s+\[)[^\]]?(\])/;
const OVERRIDE_MARKER_RE = /\s*\[tt-override::\s*[A-Za-z]+\s*\]/;
const TRAILING_ID_RE = /(\s+\^[A-Za-z0-9-]+)\s*$/;

/**
 * Operation B — change state. Swap the status character on one task line.
 * Length-preserving except for the (rare) single-character delta, so downstream
 * line numbers stay stable. Returns the text unchanged if the line is not a task.
 */
export function setStatusInText(text: string, line: number, newStatus: string): string {
	const lines = text.split("\n");
	const l = lines[line];
	if (l === undefined || !STATUS_RE.test(l)) return text;
	lines[line] = l.replace(STATUS_RE, (_m, p1: string, p2: string) => p1 + newStatus + p2);
	return lines.join("\n");
}

/**
 * Mark a node as a manual override of a role: writes the visible `[tt-override:: role]`
 * field (before any block id) and sets the checkbox to the role's canonical character.
 */
export function setOverrideInText(
	text: string,
	line: number,
	role: Role,
	columns: ColumnDef[],
): string {
	const lines = text.split("\n");
	let l = lines[line];
	if (l === undefined) return text;
	l = removeOverrideMarker(l);

	const field = ` [tt-override:: ${role}]`;
	const idMatch = TRAILING_ID_RE.exec(l);
	if (idMatch) {
		l = l.slice(0, idMatch.index) + field + idMatch[0];
	} else {
		l = l.replace(/\s*$/, "") + field;
	}
	l = l.replace(STATUS_RE, (_m, p1: string, p2: string) => p1 + canonicalStatusForRole(role, columns) + p2);
	lines[line] = l;
	return lines.join("\n");
}

/** Remove a manual override marker from one line (leaves the checkbox as-is). */
export function clearOverrideInText(text: string, line: number): string {
	const lines = text.split("\n");
	const l = lines[line];
	if (l === undefined) return text;
	lines[line] = removeOverrideMarker(l);
	return lines.join("\n");
}

function removeOverrideMarker(line: string): string {
	return line.replace(OVERRIDE_MARKER_RE, "");
}

export interface AssignIdsOptions {
	prefix?: string;
	length?: number;
}

/**
 * Append a stable ` ^id` to every task line that lacks one. Skips the YAML
 * frontmatter block and any non-task line. Existing ids are never touched.
 */
export function assignIdsInText(
	text: string,
	opts: AssignIdsOptions = {},
): { text: string; assigned: number } {
	const prefix = opts.prefix ?? "t-";
	const length = opts.length ?? 6;
	const lines = text.split("\n");
	const existing = collectBlockIds(lines);
	const bodyStart = frontmatterEndLine(lines);
	let assigned = 0;

	for (let i = bodyStart; i < lines.length; i++) {
		const l = lines[i];
		if (l === undefined) continue;
		const p = parseLine(l);
		if (!p.isTask || p.blockId) continue;
		const id = generateId(existing, prefix, length);
		lines[i] = l.replace(/\s*$/, "") + " ^" + id;
		assigned += 1;
	}

	return { text: lines.join("\n"), assigned };
}

/** Index of the first body line (after a leading `--- ... ---` frontmatter block). */
export function frontmatterEndLine(lines: string[]): number {
	if (lines[0] !== "---") return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---") return i + 1;
	}
	return 0;
}

export interface MoveSubtreeOptions {
	/** Inclusive line range [start..end] of the subtree being moved. */
	start: number;
	end: number;
	/** Insert the block *after* this original line index; use -1 to insert at bodyStart. */
	insertAfter: number;
	/** Depth of the moved root before and after the move. */
	oldDepth: number;
	newDepth: number;
	/** One indent unit, e.g. "\t" or "    ". */
	indentUnit: string;
	/** Where the body begins (used only when insertAfter is -1). */
	bodyStart?: number;
}

/**
 * Operation A — restructure. Cut a contiguous subtree and paste it elsewhere,
 * re-indenting the whole branch by the depth delta. Every status character and
 * block id inside the branch is preserved verbatim.
 */
export function moveSubtreeInText(text: string, opts: MoveSubtreeOptions): string {
	const { start, end, insertAfter, oldDepth, newDepth, indentUnit } = opts;
	const lines = text.split("\n");
	if (start < 0 || end >= lines.length || start > end) return text;
	if (insertAfter >= start && insertAfter <= end) return text; // cannot drop inside itself

	const delta = newDepth - oldDepth;
	const block = lines.slice(start, end + 1).map((l) => reindent(l, delta, indentUnit));
	const without = [...lines.slice(0, start), ...lines.slice(end + 1)];
	const blockLen = end - start + 1;

	let insertIdx: number;
	if (insertAfter < 0) {
		insertIdx = opts.bodyStart ?? 0;
	} else if (insertAfter < start) {
		insertIdx = insertAfter + 1;
	} else {
		insertIdx = insertAfter + 1 - blockLen;
	}
	insertIdx = Math.max(0, Math.min(insertIdx, without.length));

	const result = [...without.slice(0, insertIdx), ...block, ...without.slice(insertIdx)];
	return result.join("\n");
}

function reindent(line: string, delta: number, unit: string): string {
	if (delta === 0) return line;
	const leadingWsLen = line.length - line.replace(/^\s+/, "").length;
	const content = line.slice(leadingWsLen);
	if (content === "") return line; // blank line: leave untouched
	const unitLen = unit.length || 1;
	const level = Math.round(leadingWsLen / unitLen);
	const newLevel = Math.max(0, level + delta);
	return unit.repeat(newLevel) + content;
}

// ---- task CRUD (dashboard editing) ------------------------------------------

/** Insert a new task line after `afterLine` (use bodyStart-1 to prepend to the body). */
export function insertTaskInText(
	text: string,
	afterLine: number,
	indentText: string,
	taskText: string,
	status = " ",
): string {
	const lines = text.split("\n");
	const at = Math.max(-1, Math.min(afterLine, lines.length - 1)) + 1;
	lines.splice(at, 0, `${indentText}- [${status}] ${taskText}`);
	return lines.join("\n");
}

/** Delete an inclusive line range (a task and its whole subtree). */
export function deleteRangeInText(text: string, start: number, end: number): string {
	const lines = text.split("\n");
	if (start < 0 || end >= lines.length || start > end) return text;
	lines.splice(start, end - start + 1);
	return lines.join("\n");
}

/** Rebuild a list line with new body text, preserving marker/status/override/blockId. */
function rebuildLine(original: string, newText: string): string {
	const p = parseLine(original);
	if (p.marker === "") return original;
	const box = p.isTask ? `[${p.statusChar || " "}] ` : "";
	const override = p.override ? ` [tt-override:: ${p.override}]` : "";
	const id = p.blockId ? ` ^${p.blockId}` : "";
	return `${p.indentText}${p.marker} ${box}${newText}${override}${id}`;
}

/** Replace a task's display text, preserving its status, override field, and block id. */
export function setTaskTextInText(text: string, line: number, newText: string): string {
	const lines = text.split("\n");
	const l = lines[line];
	if (l === undefined) return text;
	lines[line] = rebuildLine(l, newText.trim());
	return lines.join("\n");
}

/** Append a #tag to a task's text (before any override field / block id); no-op if already present. */
export function addTagInText(text: string, line: number, tag: string): string {
	const lines = text.split("\n");
	const l = lines[line];
	if (l === undefined) return text;
	const clean = tag.replace(/^#+/, "").trim().replace(/\s+/g, "-");
	if (!clean) return text;
	const p = parseLine(l);
	if (p.text.split(/\s+/).includes(`#${clean}`)) return text;
	lines[line] = rebuildLine(l, `${p.text} #${clean}`.trim());
	return lines.join("\n");
}
