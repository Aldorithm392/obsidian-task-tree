import { MarkdownRenderer, setIcon, type App, type Component } from "obsidian";
import type { ColumnDef, Role, TaskNode } from "../model/types.ts";
import type { EdgeGraph } from "../model/insights.ts";
import { columnForRole, columnForStatus } from "../columns.ts";

/**
 * A task's title as the human should see it: the trailing link to its OWN note is hidden
 * (the file keeps it — it's the agent-facing edge). A task whose text is only the link
 * falls back to the note name. This used to be a setting whose "on" value simply showed
 * every title twice; there was only ever one right answer.
 */
export function taskDisplayText(node: TaskNode): string {
	if (!node.ownNoteLink) return node.text;
	const stripped = node.text.replace(/\s*\[\[[^\]]+\]\]\s*$/, "").trim();
	return stripped || node.ownNoteLink;
}

/** What a node's dependency badge needs to know, extracted from the board's edge graph. */
export function dependencyInfo(
	node: TaskNode,
	graph: EdgeGraph,
): { held: TaskNode[]; unresolved: string[]; onCycle: boolean } {
	const held = graph.edges
		.filter((e) => e.from.id === node.id && e.to.effectiveRole !== "done" && e.to.effectiveRole !== "cancelled")
		.map((e) => e.to);
	return { held, unresolved: graph.unresolved.get(node.id) ?? [], onCycle: graph.cycleIds.has(node.id) };
}

/** Anything that justifies a full Markdown pass; plain text takes the cheap path.
 * Deliberately no lone `=` / `~` — "task = note" is prose, only `==`/`~~` are syntax. */
const MD_SYNTAX = /[[\]*_`#]|==|~~|https?:\/\//;

/**
 * Render a task's text into `parent`: plain span when there is no Markdown in it
 * (the common case — keeps big boards cheap), full MarkdownRenderer otherwise, so
 * task-note [[links]], tags and emphasis render properly. Clicking an internal
 * link opens it; the caller's edit trigger should ignore clicks on links.
 */
export function renderTaskText(
	app: App,
	component: Component,
	parent: HTMLElement,
	cls: string,
	text: string,
	sourcePath: string,
): HTMLElement {
	const host = parent.createSpan({ cls });
	const t = text || "(untitled)";
	if (!MD_SYNTAX.test(t)) {
		host.setText(t);
		return host;
	}
	host.addClass("tt-md");
	void MarkdownRenderer.render(app, t, host, sourcePath, component);
	host.addEventListener("click", (e) => {
		const a = (e.target as HTMLElement).closest("a.internal-link");
		if (!a || !host.contains(a)) return;
		e.preventDefault();
		e.stopPropagation();
		const href = a.getAttribute("data-href") ?? a.getAttribute("href");
		if (href) void app.workspace.openLinkText(href, sourcePath, true);
	});
	return host;
}

export function roleLabel(role: Role): string {
	return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * One glyph per role, so a "Mark as …" menu scans by shape instead of five identical
 * check marks. Long-standing Lucide names only — Obsidian ships whatever Lucide
 * version it likes, and a renamed icon would silently render nothing.
 */
const ROLE_ICON: Record<Role, string> = {
	todo: "circle",
	doing: "play",
	done: "check",
	cancelled: "x",
	blocked: "ban",
};

export function roleIcon(role: Role): string {
	return ROLE_ICON[role];
}

/**
 * The column a task belongs to: a leaf goes by its own status character; a parent
 * goes by its derived (rolled-up) role.
 */
export function placementColumn(node: TaskNode, columns: ColumnDef[]): ColumnDef | undefined {
	if (node.isLeaf) {
		return columnForStatus(node.statusChar, columns) ?? columnForRole(node.effectiveRole, columns);
	}
	return columnForRole(node.effectiveRole, columns);
}

export function createStatusChip(parent: HTMLElement, node: TaskNode, columns: ColumnDef[]): HTMLElement {
	// A leaf whose character nothing claimed shows the character itself. The role behind it
	// is a fallback guess, and a guess rendered as a confident label is how a board comes to
	// say something its author never wrote. Naming it makes it a one-click fix instead.
	if (node.isTask && node.isLeaf && !node.statusMapped) {
		const chip = parent.createSpan({ cls: "tt-chip is-unmapped", text: `[${node.statusChar}] unmapped` });
		chip.setAttribute("data-role", node.effectiveRole);
		chip.setAttribute(
			"aria-label",
			`No column claims "${node.statusChar}", and it isn't one of the published characters — ` +
				`reading it as ${roleLabel(node.effectiveRole)}. Add a column for it, or change the character.`,
		);
		return chip;
	}
	const col = columnForRole(node.effectiveRole, columns);
	const chip = parent.createSpan({
		cls: "tt-chip",
		text: col ? col.name : roleLabel(node.effectiveRole),
	});
	chip.setAttribute("data-role", node.effectiveRole);
	if (col?.color) chip.style.setProperty("--tt-chip-color", col.color);
	return chip;
}

export function createProgressBadge(parent: HTMLElement, node: TaskNode): HTMLElement | null {
	if (node.progress.total <= 0) return null;
	const wrap = parent.createSpan({ cls: "tt-progress" });
	wrap.createSpan({
		cls: "tt-progress-text",
		text: `${node.progress.done}/${node.progress.total}`,
	});
	const bar = wrap.createDiv({ cls: "tt-progress-bar" });
	const fill = bar.createDiv({ cls: "tt-progress-fill" });
	const pct = Math.round((node.progress.done / node.progress.total) * 100);
	fill.style.width = pct + "%";
	return wrap;
}

/**
 * The depth badge: checklist work found in the task's own note and the task-notes
 * below it. Read-only — it reports what the board can't see, and never changes a
 * single status character. Silent when there is no note work at all.
 */
export function createNoteProgressBadge(parent: HTMLElement, node: TaskNode): HTMLElement | null {
	const p = node.noteProgress;
	if (!p || p.total <= 0) return null;
	const badge = parent.createSpan({ cls: "tt-note-progress" });
	if (p.done < p.total) badge.addClass("is-open");
	setIcon(badge, "list-checks");
	badge.createSpan({ cls: "tt-note-progress-text", text: `${p.done}/${p.total}${p.truncated ? "+" : ""}` });
	const where =
		p.notes === 1 ? "its note" : `its note and ${p.notes - 1} linked note${p.notes === 2 ? "" : "s"}`;
	badge.setAttribute(
		"aria-label",
		`${p.done} of ${p.total} checklist items done in ${where}` +
			(p.truncated ? " — deeper notes not counted" : ""),
	);
	return badge;
}

export function createOverrideBadge(parent: HTMLElement, role: Role): HTMLElement {
	const b = parent.createSpan({
		cls: "tt-override-badge",
		attr: { "aria-label": `Manually set to ${roleLabel(role)}` },
	});
	setIcon(b, "lock");
	return b;
}

/**
 * Dependency badge for a task with `tt-blocked-by` edges. Red (ban icon) while an
 * unfinished dependency holds it, plain link icon once everything released; warns
 * on unresolved ids and cycles.
 */
export function createDependencyBadge(
	parent: HTMLElement,
	node: TaskNode,
	deps: { held: TaskNode[]; unresolved: string[]; onCycle: boolean },
): HTMLElement | null {
	if (node.blockedBy.length === 0) return null;
	const b = parent.createSpan({ cls: "tt-dep-badge" });
	const problems: string[] = [];
	if (deps.held.length > 0) {
		b.addClass("tt-dep-held");
		problems.push(`Waiting on: ${deps.held.map((d) => taskDisplayText(d) || d.id).join(", ")}`);
	}
	if (deps.unresolved.length > 0) {
		b.addClass("tt-dep-warn");
		problems.push(`Unknown id${deps.unresolved.length === 1 ? "" : "s"}: ${deps.unresolved.join(", ")}`);
	}
	if (deps.onCycle) {
		b.addClass("tt-dep-warn");
		problems.push("Dependency cycle");
	}
	setIcon(b, deps.held.length > 0 ? "ban" : "link");
	b.setAttribute(
		"aria-label",
		problems.length > 0 ? problems.join(" · ") : `Depends on ${node.blockedBy.length} task${node.blockedBy.length === 1 ? "" : "s"} (all released)`,
	);
	return b;
}

/** Build a small parent-chain breadcrumb (used in the flattened Kanban cards). */
export function breadcrumb(parent: HTMLElement, chain: string[]): void {
	if (chain.length === 0) return;
	parent.createSpan({ cls: "tt-breadcrumb", text: chain.join(" › ") });
}
