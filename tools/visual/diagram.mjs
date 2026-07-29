// Visual harness: render the EXACT DOM the plugin emits for the diagram layout,
// against the real styles.css, in real Chromium — so layout claims can be seen
// instead of guessed at. Obsidian can't run here; its CSS variables can.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const css = readFileSync(resolve(REPO, "styles.css"), "utf8");

// A believable subset of Obsidian's theme variables (light).
const VARS = `
:root {
  --background-primary: #ffffff;
  --background-primary-alt: #f5f6f8;
  --background-secondary: #f2f3f5;
  --background-modifier-border: #d4d6da;
  --background-modifier-hover: rgba(0,0,0,.05);
  --background-modifier-active-hover: rgba(0,0,0,.08);
  --text-normal: #1f2225;
  --text-muted: #6b7076;
  --text-faint: #9aa0a6;
  --text-accent: #6c5ce7;
  --text-on-accent: #fff;
  --text-error: #c0392b;
  --interactive-accent: #6c5ce7;
  --color-red: #c0392b;
  --color-orange: #d17a22;
  --color-yellow: #c99a2e;
  --radius-s: 4px;
  --radius-m: 8px;
  --font-ui-smaller: 11px;
  --font-ui-small: 13px;
  --font-ui-medium: 15px;
  --font-monospace: ui-monospace, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; color: var(--text-normal);
       background: var(--background-primary); }
#host { height: 780px; width: 1180px; display: flex; flex-direction: column; }
`;

/** The row content buildRowContent() produces, as static HTML. */
function rowContent(node) {
	const chip = `<span class="tt-chip" data-role="${node.role ?? "todo"}">${node.roleName ?? "To Do"}</span>`;
	const progress =
		node.progress
			? `<span class="tt-progress"><span class="tt-progress-text">${node.progress}</span>` +
				`<div class="tt-progress-bar"><div class="tt-progress-fill" style="width:50%"></div></div></span>`
			: "";
	const noteBadge = node.notes
		? `<span class="tt-note-progress is-open"><svg width="13" height="13"></svg>` +
			`<span class="tt-note-progress-text">${node.notes}</span></span>`
		: "";
	return (
		`<span class="tt-drag-handle"><svg width="14" height="14"></svg></span>` +
		`<span class="tt-toggle${node.children?.length ? "" : " tt-toggle-empty"}">` +
		`${node.children?.length ? '<svg width="16" height="16"></svg>' : ""}</span>` +
		`<input type="checkbox" class="tt-checkbox">` +
		`<span class="tt-node-text">${node.text}</span>` +
		`<div class="tt-node-meta">${chip}${progress}${noteBadge}` +
		`<span class="tt-row-btn tt-note-btn"><svg width="14" height="14"></svg></span>` +
		`<span class="tt-row-btn tt-add-btn"><svg width="14" height="14"></svg></span>` +
		`</div>`
	);
}

function dnode(node) {
	const kids = node.children?.length
		? `<div class="tt-dchildren" data-parent-id="${node.id}">${node.children.map(dnode).join("")}</div>`
		: "";
	return (
		`<div class="tt-dnode" data-id="${node.id}" data-depth="${node.depth ?? 0}">` +
		`<div class="tt-dbox tt-node-body" data-status=" ">${rowContent(node)}</div>${kids}</div>`
	);
}

export function diagramHtml(tree, { inverted = false, goal = "Website redesign" } = {}) {
	const canvasCls = `tt-diagram${inverted ? " is-inverted" : ""}`;
	const goalBox =
		`<div class="tt-dbox tt-goal-box tt-node-body">` +
		`<span class="tt-node-text tt-goal-text">${goal}</span>` +
		`<div class="tt-node-meta"><span class="tt-progress">` +
		`<span class="tt-progress-text">4/17</span><div class="tt-progress-bar">` +
		`<div class="tt-progress-fill" style="width:24%"></div></div></span></div></div>`;
	return `<style>${VARS}</style><style>${css}</style>
<div id="host" class="tt-view">
  <div class="tt-tree tt-scroll">
    <div class="${canvasCls}" data-parent-id="">
      <div class="tt-dnode">${goalBox}
        <div class="tt-dchildren">${tree.map(dnode).join("")}</div>
      </div>
    </div>
  </div>
</div>`;
}

/** A tree built to trigger the reported bug: sibling subtrees of wildly different height. */
export const UNEVEN_TREE = [
	{ id: "t-a", text: "Discovery", role: "done", roleName: "Done", progress: "2/2", children: [
		{ id: "t-a1", text: "Stakeholder interviews", role: "done", roleName: "Done" },
		{ id: "t-a2", text: "Analytics audit", role: "done", roleName: "Done" },
	] },
	{ id: "t-b", text: "Design", role: "doing", roleName: "Doing", progress: "1/4", notes: "3/11", children: [
		{ id: "t-b1", text: "Wireframes", role: "done", roleName: "Done" },
		{ id: "t-b2", text: "Visual language", role: "doing", roleName: "Doing", children: [
			{ id: "t-b2a", text: "Typography scale", role: "todo", roleName: "To Do" },
			{ id: "t-b2b", text: "Colour tokens", role: "todo", roleName: "To Do" },
			{ id: "t-b2c", text: "Iconography", role: "todo", roleName: "To Do" },
		] },
		{ id: "t-b3", text: "Component library", role: "todo", roleName: "To Do", children: [
			{ id: "t-b3a", text: "Buttons", role: "todo", roleName: "To Do" },
			{ id: "t-b3b", text: "Forms", role: "todo", roleName: "To Do" },
		] },
		{ id: "t-b4", text: "Design review", role: "todo", roleName: "To Do" },
	] },
	{ id: "t-c", text: "Ship", role: "todo", roleName: "To Do" },
	{ id: "t-d", text: "Post-launch", role: "todo", roleName: "To Do", children: [
		{ id: "t-d1", text: "Measure", role: "todo", roleName: "To Do" },
	] },
];

