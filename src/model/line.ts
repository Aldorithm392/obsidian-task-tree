import type { ParsedLine, Role } from "./types.ts";
import { ALL_ROLES } from "./types.ts";

const LIST_RE = /^(\s*)([-*+])(\s+)(.*)$/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
const CHECKBOX_RE = /^\[(.)\]\s?(.*)$/;
const OVERRIDE_RE = /\[tt-override::\s*([A-Za-z]+)\s*\]/;

/** Map a free string to a Role, or undefined if it is not a valid role. */
export function normalizeRole(s: string): Role | undefined {
	const r = s.toLowerCase();
	return (ALL_ROLES as string[]).includes(r) ? (r as Role) : undefined;
}

/**
 * Parse one raw Markdown line into its structural pieces. Never throws; a line
 * that is not a list item comes back with marker "" and isTask false.
 */
export function parseLine(raw: string): ParsedLine {
	const listMatch = LIST_RE.exec(raw);
	if (!listMatch) {
		const ws = /^\s*/.exec(raw);
		return {
			indentText: ws ? ws[0] : "",
			marker: "",
			isTask: false,
			statusChar: "",
			text: raw.trim(),
		};
	}

	const indentText = listMatch[1] ?? "";
	const marker = listMatch[2] ?? "-";
	let body = listMatch[4] ?? "";

	// Pull a trailing block id off the end first.
	let blockId: string | undefined;
	const idMatch = BLOCK_ID_RE.exec(body);
	if (idMatch) {
		blockId = idMatch[1];
		body = body.slice(0, idMatch.index);
	}

	// Detect a checkbox.
	let isTask = false;
	let statusChar = "";
	let afterBox = body;
	const boxMatch = CHECKBOX_RE.exec(body);
	if (boxMatch) {
		isTask = true;
		statusChar = boxMatch[1] ?? " ";
		afterBox = boxMatch[2] ?? "";
	}

	// Extract an override inline field and remove it from the display text.
	let override: Role | undefined;
	const ovMatch = OVERRIDE_RE.exec(afterBox);
	if (ovMatch) {
		const role = normalizeRole(ovMatch[1] ?? "");
		if (role) {
			override = role;
			afterBox = afterBox.slice(0, ovMatch.index) + afterBox.slice(ovMatch.index + ovMatch[0].length);
		}
	}

	return {
		indentText,
		marker,
		isTask,
		statusChar,
		text: afterBox.trim(),
		override,
		blockId,
	};
}
