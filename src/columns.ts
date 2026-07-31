import type { ColumnDef, Role } from "./model/types.ts";

/**
 * The default column set ships equal to the universal Obsidian / Tasks convention,
 * so a board that declares nothing is still self-describing by community standard.
 *
 * `blocked` is here and `cancelled` is not, and the asymmetry is deliberate. Blocked work
 * is *in* the flow — it is the lane you most want to see filling up. Cancelled work is out
 * of it, and a permanent empty "Cancelled" lane on every board would tax every user for a
 * state most boards never reach. It is still reachable (the menu offers every role, not
 * every column) and it still gets a lane the moment a board actually has one — see
 * `boardLanes`. Neither character is a reinterpretation: `roleForStatus` has honoured the
 * published table since 1.1.1, so `[!]` and `[-]` already meant this.
 */
export const DEFAULT_COLUMNS: ColumnDef[] = [
	{ id: "todo", name: "To Do", status: " ", role: "todo" },
	{ id: "doing", name: "Doing", status: "/", role: "doing" },
	{ id: "blocked", name: "Blocked", status: "!", role: "blocked" },
	{ id: "done", name: "Done", status: "x", role: "done" },
];

/**
 * The canonical character per role. This table is not an implementation detail — it is
 * PUBLISHED in `docs/03_FORMAT_SPEC.md`, in `docs/agent/CONTRACT.md`, and in the skill the
 * plugin installs into the user's own vault. Both directions must honour it.
 */
const ROLE_FALLBACK_STATUS: Record<Role, string> = {
	todo: " ",
	doing: "/",
	done: "x",
	cancelled: "-",
	blocked: "!",
};

/** The reverse of ROLE_FALLBACK_STATUS, so one table stays the single source of truth. */
const ROLE_FOR_PUBLISHED_STATUS = new Map<string, Role>(
	(Object.entries(ROLE_FALLBACK_STATUS) as Array<[Role, string]>).map(([role, ch]) => [ch, role]),
);

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

/** The role the PUBLISHED table gives a character, or undefined if it names none. */
export function publishedRoleFor(ch: string): Role | undefined {
	return ROLE_FOR_PUBLISHED_STATUS.get(norm(ch));
}

/**
 * Does this column set mean something the published table does not already say?
 *
 * Compared against the PUBLISHED table, never against the vault setting — comparing a
 * board to the reader's own configuration is circular, and is why a board could match
 * its author's settings perfectly and still be unreadable to anyone else. Only the
 * char → role mapping counts; renaming "Doing" to "In Progress" changes what a human
 * reads, not what the file means, so it isn't worth writing into every board.
 */
export function deviatesFromPublished(columns: ColumnDef[]): boolean {
	return columns.some((c) => publishedRoleFor(c.status) !== c.role);
}

/**
 * Resolve a status character, reporting whether anything actually claimed it.
 * `mapped: false` means the role is a guess (`unknownRole`) — the caller should say so
 * out loud rather than let a character quietly mean something it was never assigned.
 */
export function resolveStatus(
	ch: string,
	columns: ColumnDef[],
	unknownRole: Role,
): { role: Role; mapped: boolean } {
	const col = columnForStatus(ch, columns);
	if (col) return { role: col.role, mapped: true };
	const published = publishedRoleFor(ch);
	if (published) return { role: published, mapped: true };
	return { role: unknownRole, mapped: false };
}

export function roleForStatus(ch: string, columns: ColumnDef[], unknownRole: Role): Role {
	const col = columnForStatus(ch, columns);
	if (col) return col.role;
	// No column claims this character — but before giving up, honour the PUBLISHED table.
	// Without this the plugin cannot read back characters it writes itself: the default
	// column set has no `-` or `!`, yet canonicalStatusForRole emits exactly those for
	// cancelled and blocked, and the contract installed in the user's vault instructs
	// agents to write them. Both came back as `doing`, so a cancelled child silently kept
	// its milestone from ever reaching done. The user's own columns always win; this only
	// fills the gap they left.
	const published = ROLE_FOR_PUBLISHED_STATUS.get(norm(ch));
	if (published) return published;
	return unknownRole;
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

/** Title case for a role with no column to name it: "cancelled" -> "Cancelled". */
function labelForRole(role: Role): string {
	return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * The lanes a Kanban board draws: the configured columns, plus one for any role that has
 * tasks on THIS board and no column to hold them.
 *
 * Without it a cancelled task fell through to `columns[0]` — the To Do lane — so work you
 * had explicitly decided not to do came back as the top of your backlog. The two obvious
 * fixes are both wrong: a permanent lane taxes every board for a state most never reach,
 * and hiding the cards makes the plugin conceal a fact the file plainly states. A lane
 * that exists exactly when it has something in it is neither.
 */
export function boardLanes(columns: ColumnDef[], rolesPresent: Iterable<Role>): ColumnDef[] {
	const lanes = [...columns];
	const seen = new Set(columns.map((c) => c.role));
	for (const role of rolesPresent) {
		if (seen.has(role)) continue;
		seen.add(role);
		lanes.push({
			// `tt-role-` cannot collide with a user column id, which is a slug they typed.
			id: `tt-role-${role}`,
			name: labelForRole(role),
			status: ROLE_FALLBACK_STATUS[role],
			role,
		});
	}
	return lanes;
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
