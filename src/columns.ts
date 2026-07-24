import type { ColumnDef, Role } from "./model/types.ts";

/**
 * The default column set ships equal to the universal Obsidian / Tasks convention,
 * so a board that declares nothing is still self-describing by community standard.
 */
export const DEFAULT_COLUMNS: ColumnDef[] = [
	{ id: "todo", name: "To Do", status: " ", role: "todo" },
	{ id: "doing", name: "Doing", status: "/", role: "doing" },
	{ id: "done", name: "Done", status: "x", role: "done" },
];

/** Fallback status characters used when no column declares a given role. */
const ROLE_FALLBACK_STATUS: Record<Role, string> = {
	todo: " ",
	doing: "/",
	done: "x",
	cancelled: "-",
	blocked: "!",
};

/** "X" and "x" are the same status; normalize before comparing. */
function norm(ch: string): string {
	return ch === "X" ? "x" : ch;
}

export function columnForStatus(ch: string, columns: ColumnDef[]): ColumnDef | undefined {
	const target = norm(ch);
	return columns.find((c) => norm(c.status) === target);
}

export function columnById(id: string, columns: ColumnDef[]): ColumnDef | undefined {
	return columns.find((c) => c.id === id);
}

export function roleForStatus(ch: string, columns: ColumnDef[], unknownRole: Role): Role {
	const col = columnForStatus(ch, columns);
	return col ? col.role : unknownRole;
}

/** The canonical status character used to *write* a role (first column with that role). */
export function canonicalStatusForRole(role: Role, columns: ColumnDef[]): string {
	const col = columns.find((c) => c.role === role);
	return col ? col.status : ROLE_FALLBACK_STATUS[role];
}

/** The canonical column used to *display* a role. */
export function columnForRole(role: Role, columns: ColumnDef[]): ColumnDef | undefined {
	return columns.find((c) => c.role === role);
}

/** Returns a list of human-readable problems with a column configuration (empty = valid). */
export function validateColumns(columns: ColumnDef[]): string[] {
	const errors: string[] = [];
	if (columns.length === 0) {
		errors.push("At least one column is required.");
		return errors;
	}
	const seenStatus = new Map<string, string>();
	const seenId = new Set<string>();
	for (const c of columns) {
		if (!c.id) errors.push(`Column "${c.name}" is missing an id.`);
		else if (seenId.has(c.id)) errors.push(`Duplicate column id "${c.id}".`);
		else seenId.add(c.id);

		if ([...c.status].length !== 1) {
			errors.push(`Column "${c.name}" must map to exactly one status character (got "${c.status}").`);
			continue;
		}
		const key = norm(c.status);
		const prev = seenStatus.get(key);
		if (prev) {
			errors.push(`Columns "${prev}" and "${c.name}" both use the status character "${c.status}".`);
		} else {
			seenStatus.set(key, c.name);
		}

		if (c.wipLimit !== undefined && (!Number.isFinite(c.wipLimit) || c.wipLimit <= 0)) {
			errors.push(`Column "${c.name}" has an invalid WIP limit (must be a positive number).`);
		}
	}
	if (!columns.some((c) => c.role === "todo")) {
		errors.push('No column has the "todo" role; new/unstarted tasks will have nowhere to live.');
	}
	if (!columns.some((c) => c.role === "done")) {
		errors.push('No column has the "done" role; roll-up can never report completion.');
	}
	return errors;
}
