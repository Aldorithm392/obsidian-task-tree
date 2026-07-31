// List-layout harness: the DOM renderListNode() emits, against the real styles.css.
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
  --interactive-accent: #6c5ce7; --color-red: #c0392b; --color-orange: #d17a22; --color-yellow: #c99a2e;
  --radius-s: 4px; --radius-m: 8px;
  --font-ui-smaller: 11px; --font-ui-small: 13px; --font-ui-medium: 15px;
  --font-monospace: ui-monospace, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; color: var(--text-normal); }
#host { height: 100%; display: flex; flex-direction: column; }
`;

function meta(node) {
	const chip = `<span class="tt-chip" data-role="${node.role ?? "todo"}">${node.roleName ?? "To Do"}</span>`;
	const prog = node.progress
		? `<span class="tt-progress"><span class="tt-progress-text">${node.progress}</span>` +
			`<div class="tt-progress-bar"><div class="tt-progress-fill" style="width:${node.pct ?? 50}%"></div></div></span>`
		: "";
	const notes = node.notes
		? `<span class="tt-note-progress is-open"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h4M3 12h4M3 18h4M11 6h10M11 12h10M11 18h10"/></svg><span class="tt-note-progress-text">${node.notes} in notes</span></span>`
		: "";
	return `<div class="tt-node-meta">${chip}${prog}${notes}` +
		`<span class="tt-row-btn tt-note-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h10l6 6v12H4z"/></svg></span>` +
		`<span class="tt-row-btn tt-add-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></span></div>`;
}

function row(node) {
	const chev = node.children?.length
		? `<span class="tt-toggle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>`
		: `<span class="tt-toggle tt-toggle-empty"></span>`;
	return `<div class="tt-row" role="treeitem" tabindex="-1" aria-level="${(node.depth ?? 0) + 1}">` +
		`<span class="tt-drag-handle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>` +
		chev +
		`<input type="checkbox" class="tt-checkbox"${node.role === "done" ? " checked" : ""}>` +
		`<span class="tt-node-text${node.role === "done" ? " tt-done" : ""}">${node.text}</span>` +
		meta(node) + `</div>`;
}

function li(node, depth = 0) {
	const n = { ...node, depth };
	const kids = node.children?.length
		? `<ul class="tt-tree-list" role="group">${node.children.map((c) => li(c, depth + 1)).join("")}</ul>`
		: "";
	return `<li class="tt-node" role="none" data-id="${node.id}" data-depth="${depth}" data-status=" ">${row(n)}${kids}</li>`;
}

export function listHtml(tree, extraCss = "") {
	return `<style>${VARS}</style><style>${css}</style><style>${extraCss}</style>
<div id="host" class="tt-view">
  <div class="tt-toolbar"><div class="tt-toolbar-title is-clickable">Website redesign</div>
    <div class="tt-toolbar-actions"><button class="tt-btn">Add task</button></div></div>
  <div class="tt-tree tt-scroll">
    <ul class="tt-tree-list tt-root-list" role="tree" aria-label="Tasks">
      ${tree.map((n) => li(n)).join("")}
    </ul>
  </div>
</div>`;
}

export const TREE = [
	{ id: "t-a", text: "Discovery", role: "done", roleName: "Done", progress: "2/2", pct: 100, children: [
		{ id: "t-a1", text: "Stakeholder interviews", role: "done", roleName: "Done" },
		{ id: "t-a2", text: "Analytics audit", role: "done", roleName: "Done" },
	] },
	{ id: "t-b", text: "Design", role: "doing", roleName: "Doing", progress: "1/4", pct: 25, notes: "8", children: [
		{ id: "t-b1", text: "Wireframes", role: "done", roleName: "Done" },
		{ id: "t-b2", text: "Visual language", role: "doing", roleName: "Doing", progress: "0/3", pct: 0, children: [
			{ id: "t-b2a", text: "Typography scale", role: "todo", roleName: "To Do" },
			{ id: "t-b2b", text: "Colour tokens", role: "todo", roleName: "To Do" },
			{ id: "t-b2c", text: "Iconography", role: "todo", roleName: "To Do" },
		] },
		{ id: "t-b3", text: "Component library", role: "todo", roleName: "To Do", children: [
			{ id: "t-b3a", text: "Buttons", role: "todo", roleName: "To Do" },
		] },
	] },
	{ id: "t-c", text: "Ship", role: "todo", roleName: "To Do", notes: "4" },
];
