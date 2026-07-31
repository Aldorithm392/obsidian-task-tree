// Kanban + dashboard-panel harness: the DOM KanbanView.render() and renderBlockersPanel()
// emit, against the real styles.css.
//
// These two surfaces carry every change from 1.7.0 (leverage badges + the ordering rule in
// "Next up") and 1.8.0 (column heads after the color/wipLimit cut), and neither was visible
// to the tree harnesses. The fixture is `examples/projects/website-redesign.md` with its real
// derived state, so the counts and badges here are the ones the plugin actually computes —
// verified against collectNextUp() rather than typed in by hand.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const css = readFileSync(resolve(REPO, "styles.css"), "utf8");

const VARS = `
:root {
  --background-primary: #ffffff; --background-primary-alt: #f5f6f8;
  --background-secondary: #f2f3f5; --background-modifier-border: #d4d6da;
  --background-modifier-hover: rgba(0,0,0,.05); --background-modifier-active-hover: rgba(0,0,0,.08);
  --text-normal: #1f2225; --text-muted: #6b7076; --text-faint: #9aa0a6;
  --text-accent: #6c5ce7; --text-on-accent: #fff; --text-error: #c0392b;
  --interactive-accent: #6c5ce7; --color-red: #c0392b; --color-orange: #d17a22;
  --color-yellow: #c99a2e; --color-green: #3aa675;
  --radius-s: 4px; --radius-m: 8px;
  --font-ui-smaller: 11px; --font-ui-small: 13px; --font-ui-medium: 15px;
  --font-monospace: ui-monospace, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; color: var(--text-normal); }
#host { height: 100%; display: flex; flex-direction: column; }
`;

const ICON = (d, s = 14) =>
	`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
const PLUS = ICON('<path d="M12 5v14M5 12h14"/>');
const WARN = ICON('<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17h.01"/>', 13);
const FILE = ICON('<path d="M4 3h10l6 6v12H4z"/>');
const HOURGLASS = ICON('<path d="M6 2h12M6 22h12M8 2v5l4 5 4-5V2M8 22v-5l4-5 4 5v5"/>', 12);

// ---- dashboard header (renderDashboardHeader) --------------------------------

function stat(role, n, label) {
	return `<span class="tt-stat" data-role="${role}"><span class="tt-stat-n">${n}</span><span class="tt-stat-l">${label}</span></span>`;
}

function dashHeader({ compact = false } = {}) {
	const t = compact ? "span" : "h2";
	return `<div class="tt-dash-header">
  <div class="tt-dash-titlerow">
    <${t} class="tt-dash-title" aria-label="Rename board">Website Redesign</${t}>
    <button class="tt-btn" aria-label="Add a task">${PLUS}<span>Add task</span></button>
  </div>
  <div class="tt-dash-stats">
    ${stat("todo", 6, "To Do")}${stat("doing", 2, "Doing")}${stat("blocked", 2, "Blocked")}${stat("done", 4, "Done")}
    <span class="tt-stat tt-stat-progress"><span class="tt-stat-n">27%</span><span class="tt-stat-l">done</span></span>
  </div>
  <span class="tt-dash-blocked">${WARN}<span>1 blocked</span></span>
</div>`;
}

// ---- blockers + next-up panel (renderBlockersPanel / renderInsightList) ------

function item({ role, path = "", text, detail = "" }) {
	return `<div class="tt-panel-item" data-role="${role}">` +
		(path ? `<span class="tt-breadcrumb">${path}</span>` : "") +
		`<span class="tt-panel-item-text">${text}</span>` +
		(detail ? `<span class="tt-panel-item-detail">${detail}</span>` : "") +
		`</div>`;
}

function section(title, items, { note = "", empty = "" } = {}) {
	const head = `<div class="tt-panel-title">${items.length ? `${title} (${items.length})` : title}</div>`;
	if (items.length === 0) return `<div class="tt-panel-sec">${head}<div class="tt-panel-empty">${empty}</div></div>`;
	return `<div class="tt-panel-sec">${head}` +
		(note ? `<div class="tt-panel-note">${note}</div>` : "") +
		items.map(item).join("") + `</div>`;
}

// Exactly what collectNextUp/collectBlockers return for examples/projects/website-redesign.md.
// "Pricing page" is the last open leaf under Wireframes, which is itself the last thing open
// under Design — so the cascade reports two milestones. "Photography" gets no badge while its
// sibling Copywriting is blocked, and that absence is the point.
export function panelHtml() {
	return `<style>${VARS}</style><style>${css}</style>
<div id="host" class="tt-view">
  ${dashHeader()}
  <div class="tt-panel">
    ${section("Blockers", [
			{ role: "blocked", path: "Content", text: "Copywriting (waiting on brand sign-off)" },
		])}
    ${section("Waiting on dependencies", [
			{ role: "todo", path: "Launch", text: "QA pass" },
			{ role: "todo", path: "Launch", text: "Announcement post" },
		])}
    ${section(
			"Next up",
			[
				{ role: "todo", path: "Design › Wireframes", text: "Pricing page", detail: "completes 2 milestones" },
				{ role: "todo", path: "Content", text: "Photography" },
			],
			{ note: "In flight first, then whatever frees the most work." },
		)}
  </div>
</div>`;
}

/** A denser Next up, to see several leverage wordings and the in-flight tier at once. */
export function leverageHtml() {
	return `<style>${VARS}</style><style>${css}</style>
<div id="host" class="tt-view">
  <div class="tt-panel">
    ${section(
			"Next up",
			[
				{ role: "doing", path: "Design › Wireframes", text: "Pricing page", detail: "completes 2 milestones" },
				{ role: "doing", path: "Content", text: "Photography" },
				{ role: "todo", path: "Infrastructure", text: "Staging box", detail: "unblocks 3 · completes “Infrastructure”" },
				{ role: "todo", path: "Launch", text: "Cut the release branch", detail: "unblocks 1" },
				{ role: "todo", path: "Design", text: "Pick a type scale", detail: "completes “Design”" },
				{ role: "todo", path: "Ship", text: "Write the changelog" },
			],
			{ note: "In flight first, then whatever frees the most work." },
		)}
  </div>
</div>`;
}

// ---- kanban board (KanbanView.render) ---------------------------------------

function card({ text, path = "", status = " ", role = "todo", derived = false, progress = "", pct = 0, dep = 0 }) {
	const cls = `tt-card${derived ? " is-derived" : ""}${role === "cancelled" ? " is-cancelled" : ""}`;
	const meta =
		// createDependencyBadge: held edges add tt-dep-held (red) and word themselves; the
		// count lives in its own tt-dep-text span, which is what makes it smaller type.
		(dep ? `<span class="tt-dep-badge tt-dep-held">${HOURGLASS}<span class="tt-dep-text">waiting on ${dep}</span></span>` : "") +
		(progress
			? `<span class="tt-progress"><span class="tt-progress-text">${progress}</span>` +
				`<div class="tt-progress-bar"><div class="tt-progress-fill" style="width:${pct}%"></div></div></span>`
			: "") +
		(derived ? `<span class="tt-parent-tag">derived</span>` : "") +
		`<span class="tt-row-btn tt-note-btn">${FILE}</span>`;
	return `<div class="${cls}" data-status="${status}">` +
		(path ? `<span class="tt-breadcrumb">${path}</span>` : "") +
		`<div class="tt-card-main"><span class="tt-card-text">${text}</span></div>` +
		`<div class="tt-card-meta">${meta}</div></div>`;
}

function column({ id, name, role, cards }) {
	const body = cards.length
		? cards.map(card).join("")
		: `<div class="tt-column-empty">Drop a task here to mark it ${name}</div>`;
	// data-role / data-col-id are the 1.8.0 snippet hooks that replaced the color picker.
	return `<div class="tt-column" data-col-id="${id}" data-role="${role}">
  <div class="tt-column-head"><span class="tt-column-name">${name}</span><span class="tt-column-count">${cards.length}</span></div>
  <div class="tt-column-cards" data-col-id="${id}">${body}</div>
</div>`;
}

// Five lanes, and the fifth is the point: Cancelled has no default column, so it exists here
// only because this board actually has cancelled work (boardLanes, 1.6.0).
const LANES = [
	{ id: "todo", name: "To Do", role: "todo", cards: [
		{ text: "Pricing page", path: "Design › Wireframes" },
		{ text: "Photography", path: "Content" },
		{ text: "Staging box", path: "Infrastructure" },
		{ text: "Launch", derived: true, progress: "0/2", pct: 0 },
		{ text: "QA pass", path: "Launch", dep: 1 },
		{ text: "Announcement post", path: "Launch", dep: 2 },
	] },
	{ id: "doing", name: "Doing", role: "doing", cards: [
		{ text: "Design", status: "/", role: "doing", derived: true, progress: "1/2", pct: 50 },
		{ text: "Wireframes", path: "Design", status: "/", role: "doing", derived: true, progress: "1/2", pct: 50 },
	] },
	{ id: "blocked", name: "Blocked", role: "blocked", cards: [
		{ text: "Content", status: "!", role: "blocked", derived: true, progress: "0/2", pct: 0 },
		{ text: "Copywriting (waiting on brand sign-off)", path: "Content", status: "!", role: "blocked" },
	] },
	{ id: "done", name: "Done", role: "done", cards: [
		{ text: "Moodboard", path: "Design", status: "x", role: "done" },
		{ text: "Home page", path: "Design › Wireframes", status: "x", role: "done" },
		{ text: "Infrastructure", status: "x", role: "done", progress: "1/2", pct: 50 },
		{ text: "Domain + DNS", path: "Infrastructure", status: "x", role: "done" },
	] },
	{ id: "tt-role-cancelled", name: "Cancelled", role: "cancelled", cards: [
		{ text: "Customer video", path: "Content", status: "-", role: "cancelled" },
	] },
];

export function kanbanHtml() {
	return `<style>${VARS}</style><style>${css}</style>
<div id="host" class="tt-view">
  ${dashHeader({ compact: true })}
  <div class="tt-kanban tt-scroll">${LANES.map(column).join("")}</div>
</div>`;
}

/**
 * The README's documented snippet, to prove the cut kept the capability.
 *
 * Deliberately loud and deliberately *against* the defaults — a snippet that happened to
 * restate the role palette would prove nothing about whether it wins. Equal specificity, so
 * this only overrides because a vault snippet loads after the plugin's stylesheet.
 */
export const SNIPPET_CSS = `
.tt-column[data-role="todo"] { --tt-col-color: #6c5ce7; }
.tt-column[data-role="doing"] { --tt-col-color: #00b894; }
.tt-column[data-col-id="tt-role-cancelled"] { --tt-col-color: #d63031; }
`;
