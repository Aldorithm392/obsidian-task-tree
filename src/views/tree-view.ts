import { Menu, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { TaskTreeView, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./base-view.ts";
import type { BoardModel } from "../board-controller.ts";
import {
	addChildTask,
	addSiblingTask,
	addTagTask,
	clearOverride,
	deleteTask,
	moveNode,
	openOrCreateTaskNote,
	renameTask,
	writeOverride,
	writeStatus,
	type TaskNoteMeta,
} from "../board-controller.ts";
import { flatten } from "../model/parser.ts";
import { computeSummary } from "../model/insights.ts";
import { getIndentUnit } from "../settings.ts";
import type { TaskNode, TreeLayout } from "../model/types.ts";
import type TaskTreePlugin from "../main.ts";
import { createOverrideBadge, createProgressBadge, createStatusChip, placementColumn } from "./card.ts";
import { confirmModal, promptText } from "./modals.ts";

interface RowOptions {
	toggle: "collapse" | "drill" | "none";
	editTrigger: "click" | "dblclick";
}

export class TreeView extends TaskTreeView {
	private collapsed = new Set<string>();
	private focusId: string | null = null;
	private fullFocus = false;
	private layout: TreeLayout;
	private inverted = false;
	private columnPath: string[] = [];
	private byId = new Map<string, TaskNode>();
	private draggingId: string | null = null;
	private dragForbidden: Set<string> | null = null; // dragged node + its subtree, computed once per drag
	private hintEl: HTMLElement | null = null; // the row currently showing a drop hint
	private hintZone: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TaskTreePlugin) {
		super(leaf, plugin);
		this.layout = plugin.settings.treeLayout;
	}

	getViewType(): string {
		return VIEW_TYPE_TREE;
	}
	getDisplayText(): string {
		return this.fullFocus ? "Task Tree — Focus" : "Task Tree — Tree";
	}
	getIcon(): string {
		return "list-tree";
	}
	protected otherViewType(): string {
		return VIEW_TYPE_KANBAN;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			layout: this.layout,
			inverted: this.inverted,
			focusId: this.focusId,
			fullFocus: this.fullFocus,
			columnPath: this.columnPath,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const s = state as Partial<{
				layout: TreeLayout;
				inverted: boolean;
				focusId: string | null;
				fullFocus: boolean;
				columnPath: string[];
			}>;
			if (s.layout === "list" || s.layout === "diagram" || s.layout === "columns") this.layout = s.layout;
			if (typeof s.inverted === "boolean") this.inverted = s.inverted;
			if (typeof s.focusId === "string" || s.focusId === null) this.focusId = s.focusId ?? null;
			if (typeof s.fullFocus === "boolean") this.fullFocus = s.fullFocus;
			if (Array.isArray(s.columnPath)) {
				this.columnPath = s.columnPath.filter((x): x is string => typeof x === "string");
			}
		}
		await super.setState(state, result);
	}

	protected buildToolbarActions(actions: HTMLElement, _model: BoardModel): void {
		const group = actions.createDiv({ cls: "tt-layout-switch" });
		const defs: Array<[TreeLayout, string, string]> = [
			["list", "list", "List"],
			["diagram", "git-fork", "Diagram"],
			["columns", "columns-3", "Columns"],
		];
		for (const [layout, icon, label] of defs) {
			const btn = group.createEl("button", { cls: "tt-layout-btn", attr: { "aria-label": label } });
			setIcon(btn, icon);
			if (this.layout === layout) btn.addClass("is-active");
			this.registerDomEvent(btn, "click", () => {
				if (this.layout === layout) return;
				this.layout = layout;
				this.app.workspace.requestSaveLayout();
				void this.render();
			});
		}

		if (this.layout === "diagram" || this.layout === "columns") {
			const flip = actions.createEl("button", {
				cls: "tt-layout-btn tt-flip-btn",
				attr: { "aria-label": "Invert: put the goal on the right, enablers flowing into it" },
			});
			setIcon(flip, "flip-horizontal-2");
			if (this.inverted) flip.addClass("is-active");
			this.registerDomEvent(flip, "click", () => {
				this.inverted = !this.inverted;
				this.app.workspace.requestSaveLayout();
				void this.render();
			});
		}
	}

	protected renderBoard(container: HTMLElement, model: BoardModel): void {
		this.buildToolbar(container, model);
		this.prepareModel(model);
		if (!this.fullFocus && this.plugin.settings.showBoardStats) {
			this.renderDashboardHeader(container, model, { compact: true });
		}
		const scroll = container.createDiv({ cls: "tt-tree tt-scroll" });
		this.renderTreeBody(scroll, model);
	}

	protected prepareModel(model: BoardModel): void {
		this.byId = new Map(flatten(model.roots).map((n) => [n.id, n]));
	}

	/** Render the focus resolution + chosen layout into `scroll`. Reused by the Dashboard view. */
	protected renderTreeBody(scroll: HTMLElement, model: BoardModel): void {
		let roots = model.roots;
		let focusNode: TaskNode | null = null;
		if (this.focusId) {
			const f = this.byId.get(this.focusId);
			if (f) {
				focusNode = f;
				roots = [f];
			} else {
				this.focusId = null;
			}
		}

		if (this.fullFocus) {
			scroll.addClass("tt-fullfocus");
			if (focusNode) this.renderFocusHeader(scroll, focusNode, model);
		}
		if (focusNode) this.renderFocusBar(scroll, focusNode, model);

		if (this.layout === "diagram") {
			this.renderDiagram(scroll, roots, model);
		} else if (this.layout === "columns") {
			this.renderColumns(scroll, roots, model);
		} else {
			this.renderList(scroll, roots, model);
		}
	}

	// ---- shared row content --------------------------------------------------

	private buildRowContent(host: HTMLElement, node: TaskNode, model: BoardModel, opts: RowOptions): void {
		host.addClass("tt-node-body");
		const hasChildren = node.children.length > 0;

		const grip = host.createSpan({ cls: "tt-drag-handle", attr: { "aria-label": "Drag onto another task to nest it" } });
		setIcon(grip, "grip-vertical");
		this.wireDrag(host, grip, node, model);

		const toggle = host.createSpan({ cls: "tt-toggle" });
		if (opts.toggle === "collapse" && hasChildren) {
			setIcon(toggle, this.collapsed.has(node.id) ? "chevron-right" : "chevron-down");
			this.registerDomEvent(toggle, "click", (e) => {
				e.stopPropagation();
				this.toggleCollapse(node.id);
			});
		} else if (opts.toggle === "drill" && hasChildren) {
			setIcon(toggle, "chevron-right");
			toggle.addClass("tt-toggle-drill");
		} else {
			toggle.addClass("tt-toggle-empty");
		}

		if (node.isTask) {
			const box = host.createEl("input", { type: "checkbox", cls: "tt-checkbox" });
			box.checked = node.effectiveRole === "done";
			this.registerDomEvent(box, "click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				void this.cycle(node, model);
			});
		}

		const text = host.createSpan({ cls: "tt-node-text", text: node.text || "(untitled)" });
		if (node.effectiveRole === "done") text.addClass("tt-done");
		this.registerDomEvent(text, opts.editTrigger, (e) => {
			e.stopPropagation();
			this.startInlineEdit(text, node, model);
		});

		const meta = host.createDiv({ cls: "tt-node-meta" });
		createStatusChip(meta, node, model.columns);
		createProgressBadge(meta, node);
		if (node.override) createOverrideBadge(meta, node.override);
		if (node.hasBlockedDescendant) {
			const warn = meta.createSpan({ cls: "tt-warn", attr: { "aria-label": "A subtask below is blocked" } });
			setIcon(warn, "alert-triangle");
		}

		if (hasChildren) {
			const focusBtn = meta.createSpan({ cls: "tt-focus-btn", attr: { "aria-label": "Open in full focus" } });
			setIcon(focusBtn, "scan-search");
			this.registerDomEvent(focusBtn, "click", (e) => {
				e.stopPropagation();
				this.startFullFocus(model, node.id);
			});
		}

		const noteBtn = meta.createSpan({ cls: "tt-row-btn tt-note-btn", attr: { "aria-label": "Open / create the task's note" } });
		setIcon(noteBtn, "file-text");
		this.registerDomEvent(noteBtn, "click", (e) => {
			e.stopPropagation();
			this.openTaskNote(node, model);
		});

		const addBtn = meta.createSpan({ cls: "tt-row-btn tt-add-btn", attr: { "aria-label": "Add subtask" } });
		setIcon(addBtn, "plus");
		this.registerDomEvent(addBtn, "click", (e) => {
			e.stopPropagation();
			void addChildTask(this.plugin, model.file, node);
		});
		const delBtn = meta.createSpan({ cls: "tt-row-btn tt-del-btn", attr: { "aria-label": "Delete task" } });
		setIcon(delBtn, "trash-2");
		this.registerDomEvent(delBtn, "click", (e) => {
			e.stopPropagation();
			void this.deletePrompt(node, model);
		});

		this.registerDomEvent(host, "contextmenu", (e) => {
			e.preventDefault();
			this.nodeMenu(e, node, model);
		});
	}

	// ---- layout: list --------------------------------------------------------

	private renderList(scroll: HTMLElement, roots: TaskNode[], model: BoardModel): void {
		const rootUl = scroll.createEl("ul", { cls: "tt-tree-list tt-root-list" });
		rootUl.dataset.parentId = "";
		rootUl.dataset.parentDepth = "-1";
		rootUl.dataset.parentLine = String(model.bodyStart - 1);
		for (const node of roots) this.renderListNode(rootUl, node, model);
	}

	private renderListNode(ul: HTMLElement, node: TaskNode, model: BoardModel): void {
		const li = ul.createEl("li", { cls: "tt-node" });
		li.dataset.id = node.id;
		li.dataset.line = String(node.line);
		li.dataset.subtreeEnd = String(node.lastDescLine);
		li.dataset.depth = String(node.depth);
		li.setAttribute("data-task", node.statusChar);

		const row = li.createDiv({ cls: "tt-row" });
		this.buildRowContent(row, node, model, {
			toggle: "collapse",
			editTrigger: "click",
		});

		if (node.children.length > 0 && !this.collapsed.has(node.id)) {
			const childUl = li.createEl("ul", { cls: "tt-tree-list" });
			childUl.dataset.parentId = node.id;
			childUl.dataset.parentDepth = String(node.depth);
			childUl.dataset.parentLine = String(node.line);
			for (const child of node.children) this.renderListNode(childUl, child, model);
		}
	}

	// ---- layout: diagram (horizontal tree) -----------------------------------

	private renderDiagram(scroll: HTMLElement, roots: TaskNode[], model: BoardModel): void {
		const canvas = scroll.createDiv({ cls: "tt-diagram" });
		if (this.inverted) canvas.addClass("is-inverted");
		canvas.dataset.parentId = "";
		canvas.dataset.parentDepth = "-1";
		canvas.dataset.parentLine = String(model.bodyStart - 1);

		// The apex of the tree is the project itself — the note. Its top-level tasks
		// are what enable it. Inverted, the goal sits on the right and the enablers
		// flow into it. While focused on a subtree, that node is the apex instead.
		if (this.focusId) {
			for (const node of roots) this.renderDiagramNode(canvas, node, model);
			return;
		}
		const gnode = canvas.createDiv({ cls: "tt-dnode" });
		const gbox = gnode.createDiv({ cls: "tt-dbox tt-goal-box" });
		this.buildGoalContent(gbox, model);
		if (roots.length > 0) {
			const kids = gnode.createDiv({ cls: "tt-dchildren" });
			for (const node of roots) this.renderDiagramNode(kids, node, model);
		}
	}

	/** The project apex (= the note): its title, overall progress, and a drop target for "lift to top level". */
	private buildGoalContent(box: HTMLElement, model: BoardModel): void {
		box.addClass("tt-node-body");
		const label = box.createSpan({ cls: "tt-node-text tt-goal-text", text: this.boardTitle(model) });
		this.registerDomEvent(label, "click", (e) => {
			e.stopPropagation();
			void this.promptRenameBoard(model);
		});

		const summary = computeSummary(model.roots);
		if (summary.total > 0) {
			const meta = box.createDiv({ cls: "tt-node-meta" });
			const wrap = meta.createSpan({ cls: "tt-progress" });
			wrap.createSpan({ cls: "tt-progress-text", text: `${summary.done}/${summary.total}` });
			const bar = wrap.createDiv({ cls: "tt-progress-bar" });
			const fill = bar.createDiv({ cls: "tt-progress-fill" });
			fill.style.width = Math.round((summary.done / summary.total) * 100) + "%";
		}

		// Drop a task here to lift it back to the project (top) level.
		this.registerDomEvent(box, "dragover", (e: DragEvent) => {
			if (!this.draggingId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.setHint(box, "inside");
		});
		this.registerDomEvent(box, "drop", (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const id = this.draggingId;
			this.endDrag();
			if (id) void this.applyDropToRoot(id, model);
		});
	}

	/** Move a dragged task to be a top-level task (child of the project goal), appended last. */
	private async applyDropToRoot(draggedId: string, model: BoardModel): Promise<void> {
		const dragged = this.byId.get(draggedId);
		if (!dragged) return;
		const roots = model.roots;
		const last = roots[roots.length - 1];
		if (dragged.depth === 0 && last && last.id === dragged.id) return; // already the last root
		const insertAfter = last && last.id !== dragged.id ? last.lastDescLine : model.bodyStart - 1;
		await moveNode(this.plugin, model.file, {
			start: dragged.line,
			end: dragged.lastDescLine,
			insertAfter,
			oldDepth: dragged.depth,
			newDepth: 0,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private renderDiagramNode(parent: HTMLElement, node: TaskNode, model: BoardModel): void {
		const dnode = parent.createDiv({ cls: "tt-dnode" });
		dnode.dataset.id = node.id;
		dnode.dataset.line = String(node.line);
		dnode.dataset.subtreeEnd = String(node.lastDescLine);
		dnode.dataset.depth = String(node.depth);
		const box = dnode.createDiv({ cls: "tt-dbox" });
		box.setAttribute("data-task", node.statusChar);
		this.buildRowContent(box, node, model, {
			toggle: "collapse",
			editTrigger: "click",
		});
		if (node.children.length > 0 && !this.collapsed.has(node.id)) {
			const kids = dnode.createDiv({ cls: "tt-dchildren" });
			kids.dataset.parentId = node.id;
			kids.dataset.parentDepth = String(node.depth);
			kids.dataset.parentLine = String(node.line);
			for (const child of node.children) this.renderDiagramNode(kids, child, model);
		}
	}

	// ---- layout: columns (Miller / drill-down) -------------------------------

	private renderColumns(scroll: HTMLElement, roots: TaskNode[], model: BoardModel): void {
		// Prune any selection ids that no longer exist (e.g. deleted by an edit).
		const pruned: string[] = [];
		for (const id of this.columnPath) {
			if (this.byId.has(id)) pruned.push(id);
			else break;
		}
		this.columnPath = pruned;

		const wrap = scroll.createDiv({ cls: "tt-columns" });
		if (this.inverted) wrap.addClass("is-inverted");
		this.renderColumnPane(wrap, roots, this.boardTitle(model), 0, model);

		for (let i = 0; i < this.columnPath.length; i++) {
			const parentId = this.columnPath[i];
			if (!parentId) break;
			const parentNode = this.byId.get(parentId);
			if (!parentNode || parentNode.children.length === 0) break;
			this.renderColumnPane(wrap, parentNode.children, parentNode.text || "…", i + 1, model);
		}

		// Inverted: put the goal pane on the right by reversing the DOM order with
		// normal flex-direction. (CSS row-reverse overflows unreachably to the left
		// in a horizontal scroll container, hiding deep panes.)
		if (this.inverted) {
			const panes = Array.from(wrap.children);
			for (let i = panes.length - 1; i >= 0; i--) {
				const pane = panes[i];
				if (pane) wrap.appendChild(pane);
			}
		}
	}

	private renderColumnPane(
		wrap: HTMLElement,
		items: TaskNode[],
		header: string,
		colIndex: number,
		model: BoardModel,
	): void {
		const selectedId = this.columnPath[colIndex];
		const pane = wrap.createDiv({ cls: "tt-column-pane" });
		pane.createDiv({ cls: "tt-column-pane-head", text: header });
		const body = pane.createDiv({ cls: "tt-column-pane-body" });
		// The drop-parent for this column: root for column 0, else the drilled node it lists.
		if (colIndex === 0) {
			body.dataset.parentId = "";
			body.dataset.parentDepth = "-1";
			body.dataset.parentLine = String(model.bodyStart - 1);
		} else {
			const parentId = this.columnPath[colIndex - 1];
			const parentNode = parentId ? this.byId.get(parentId) : undefined;
			if (parentNode) {
				body.dataset.parentId = parentNode.id;
				body.dataset.parentDepth = String(parentNode.depth);
				body.dataset.parentLine = String(parentNode.line);
			}
		}
		for (const node of items) {
			const item = body.createDiv({ cls: "tt-col-item" });
			item.dataset.id = node.id;
			item.dataset.line = String(node.line);
			item.dataset.subtreeEnd = String(node.lastDescLine);
			item.setAttribute("data-task", node.statusChar);
			if (node.id === selectedId) item.addClass("is-selected");
			this.buildRowContent(item, node, model, {
				toggle: "drill",
				editTrigger: "dblclick",
			});
			this.registerDomEvent(item, "click", () => this.selectColumn(node, colIndex));
		}
	}

	private selectColumn(node: TaskNode, colIndex: number): void {
		const path = this.columnPath.slice(0, colIndex);
		path.push(node.id);
		this.columnPath = path;
		this.app.workspace.requestSaveLayout();
		void this.render();
	}

	// ---- full focus ----------------------------------------------------------

	private startFullFocus(model: BoardModel, id: string): void {
		void this.plugin.activateFocusView(model.file.path, id);
	}

	/** Open (or create + link) the task's own note, with its structural frontmatter. */
	private openTaskNote(node: TaskNode, model: BoardModel): void {
		const path: string[] = [];
		let pid = node.parentId;
		let guard = 0;
		while (pid && guard++ < 50) {
			const p = this.byId.get(pid);
			if (!p) break;
			path.unshift(p.text);
			pid = p.parentId;
		}
		const parent = node.parentId ? this.byId.get(node.parentId) : undefined;
		const meta: TaskNoteMeta = { depth: node.depth, path, parentText: parent ? parent.text : null };
		void openOrCreateTaskNote(this.plugin, model, node, meta);
	}

	private renderFocusHeader(container: HTMLElement, node: TaskNode, model: BoardModel): void {
		const head = container.createDiv({ cls: "tt-fullfocus-header" });
		head.createEl("h2", { cls: "tt-fullfocus-title", text: node.text || "(untitled)" });
		const meta = head.createDiv({ cls: "tt-node-meta" });
		createStatusChip(meta, node, model.columns);
		createProgressBadge(meta, node);
		if (node.override) createOverrideBadge(meta, node.override);
	}

	/** Change the in-place focus. Always clears the columns drill path so the two can't desync. */
	private setFocus(id: string | null): void {
		this.focusId = id;
		this.columnPath = [];
		this.app.workspace.requestSaveLayout();
		void this.render();
	}

	private renderFocusBar(container: HTMLElement, node: TaskNode, model: BoardModel): void {
		const bar = container.createDiv({ cls: "tt-focus-bar" });
		const exit = bar.createEl("button", { cls: "tt-btn", text: "All tasks" });
		this.registerDomEvent(exit, "click", () => this.setFocus(null));
		const chain: TaskNode[] = [];
		let pid = node.parentId;
		let guard = 0;
		while (pid && guard++ < 50) {
			const p = this.byId.get(pid);
			if (!p) break;
			chain.unshift(p);
			pid = p.parentId;
		}
		for (const anc of chain) {
			bar.createSpan({ cls: "tt-focus-sep", text: "›" });
			const crumb = bar.createSpan({ cls: "tt-focus-crumb", text: anc.text || "…" });
			this.registerDomEvent(crumb, "click", () => this.setFocus(anc.id));
		}
		bar.createSpan({ cls: "tt-focus-sep", text: "›" });
		bar.createSpan({ cls: "tt-focus-current", text: node.text || "…" });
	}

	// ---- interactions --------------------------------------------------------

	private toggleCollapse(id: string): void {
		if (this.collapsed.has(id)) this.collapsed.delete(id);
		else this.collapsed.add(id);
		void this.render();
	}

	private cycle(node: TaskNode, model: BoardModel): Promise<void> {
		if (node.isLeaf) {
			const cur = placementColumn(node, model.columns);
			const idx = cur ? model.columns.findIndex((c) => c.id === cur.id) : -1;
			const next = model.columns[(idx + 1) % model.columns.length];
			if (next) return writeStatus(this.plugin, model.file, node.line, next.status);
			return Promise.resolve();
		}
		if (node.override) return clearOverride(this.plugin, model.file, node.line);
		return writeOverride(this.plugin, model.file, node.line, "done", model.columns);
	}

	private siblings(node: TaskNode, model: BoardModel): TaskNode[] {
		if (node.parentId) {
			const p = this.byId.get(node.parentId);
			return p ? p.children : model.roots;
		}
		return model.roots;
	}

	private async indent(node: TaskNode, model: BoardModel): Promise<void> {
		const sibs = this.siblings(node, model);
		const idx = sibs.findIndex((n) => n.id === node.id);
		const prev = idx > 0 ? sibs[idx - 1] : undefined;
		if (!prev) return;
		await moveNode(this.plugin, model.file, {
			start: node.line,
			end: node.lastDescLine,
			insertAfter: prev.lastDescLine,
			oldDepth: node.depth,
			newDepth: prev.depth + 1,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private async outdent(node: TaskNode, model: BoardModel): Promise<void> {
		if (!node.parentId) return;
		const parent = this.byId.get(node.parentId);
		if (!parent) return;
		await moveNode(this.plugin, model.file, {
			start: node.line,
			end: node.lastDescLine,
			insertAfter: parent.lastDescLine,
			oldDepth: node.depth,
			newDepth: parent.depth,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private parentLineOf(node: TaskNode, model: BoardModel): number {
		if (!node.parentId) return model.bodyStart - 1;
		return this.byId.get(node.parentId)?.line ?? model.bodyStart - 1;
	}

	private async moveUp(node: TaskNode, model: BoardModel): Promise<void> {
		const sibs = this.siblings(node, model);
		const idx = sibs.findIndex((n) => n.id === node.id);
		if (idx <= 0) return;
		const twoBefore = sibs[idx - 2];
		const insertAfter = twoBefore ? twoBefore.lastDescLine : this.parentLineOf(node, model);
		await moveNode(this.plugin, model.file, {
			start: node.line,
			end: node.lastDescLine,
			insertAfter,
			oldDepth: node.depth,
			newDepth: node.depth,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private async moveDown(node: TaskNode, model: BoardModel): Promise<void> {
		const sibs = this.siblings(node, model);
		const idx = sibs.findIndex((n) => n.id === node.id);
		const next = idx >= 0 ? sibs[idx + 1] : undefined;
		if (!next) return;
		await moveNode(this.plugin, model.file, {
			start: node.line,
			end: node.lastDescLine,
			insertAfter: next.lastDescLine,
			oldDepth: node.depth,
			newDepth: node.depth,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	/** Move a node to be the last of its current siblings (reliable "drop at the end"). */
	private async moveToEnd(node: TaskNode, model: BoardModel): Promise<void> {
		const sibs = this.siblings(node, model);
		const last = sibs[sibs.length - 1];
		if (!last || last.id === node.id) return; // already last
		await moveNode(this.plugin, model.file, {
			start: node.line,
			end: node.lastDescLine,
			insertAfter: last.lastDescLine,
			oldDepth: node.depth,
			newDepth: node.depth,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private subtreeIds(node: TaskNode): Set<string> {
		const ids = new Set<string>();
		const walk = (n: TaskNode): void => {
			ids.add(n.id);
			for (const c of n.children) walk(c);
		};
		walk(node);
		return ids;
	}

	// ---- native drag-and-drop: drop ONTO a task to nest it ------------------
	//
	// The grip is the only draggable element; every row/box is a drop target.
	// Where you release decides what happens, like an outliner:
	//   • top edge    → drop ABOVE the target (same level, reorder)
	//   • middle      → NEST as the target's last child (go deeper / "to the right")
	//   • bottom edge → drop BELOW the target (same level, reorder)
	// A leaf is a valid middle-drop target — it simply becomes a parent.

	private static readonly DROP_HINTS = ["tt-drop-before", "tt-drop-after", "tt-drop-inside"] as const;

	private wireDrag(host: HTMLElement, grip: HTMLElement, node: TaskNode, model: BoardModel): void {
		grip.draggable = true;

		this.registerDomEvent(grip, "dragstart", (e: DragEvent) => {
			this.draggingId = node.id;
			this.dragForbidden = this.subtreeIds(node); // compute the no-drop set ONCE, not per dragover
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", node.id);
				e.dataTransfer.setDragImage(host, 12, 12);
			}
			host.addClass("tt-dragging");
		});
		this.registerDomEvent(grip, "dragend", () => {
			this.endDrag();
			host.removeClass("tt-dragging");
		});

		// No dragleave handler: a single tracked hint (setHint/clearHint) avoids the
		// flicker of dragleave firing every time the cursor crosses a child element.
		this.registerDomEvent(host, "dragover", (e: DragEvent) => {
			if (!this.draggingId || node.id === this.draggingId || this.dragForbidden?.has(node.id)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.setHint(host, this.dropZone(e, host));
		});
		this.registerDomEvent(host, "drop", (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const draggedId = this.draggingId;
			const zone = this.dropZone(e, host);
			this.endDrag();
			if (draggedId) void this.applyDrop(draggedId, node, zone, model);
		});
	}

	private dropZone(e: DragEvent, el: HTMLElement): "before" | "after" | "inside" {
		const rect = el.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const h = rect.height || 1;
		if (y < h * 0.28) return "before";
		if (y > h * 0.72) return "after";
		return "inside";
	}

	/** Show a drop hint on `el` for `zone`, moving it there only if it actually changed. */
	private setHint(el: HTMLElement, zone: string): void {
		if (this.hintEl === el && this.hintZone === zone) return;
		this.clearHint();
		el.addClass(`tt-drop-${zone}`);
		this.hintEl = el;
		this.hintZone = zone;
	}

	private clearHint(): void {
		if (this.hintEl) this.hintEl.removeClass(...TreeView.DROP_HINTS);
		this.hintEl = null;
		this.hintZone = null;
	}

	private endDrag(): void {
		this.draggingId = null;
		this.dragForbidden = null;
		this.clearHint();
	}

	private async applyDrop(
		draggedId: string,
		target: TaskNode,
		zone: "before" | "after" | "inside",
		model: BoardModel,
	): Promise<void> {
		const dragged = this.byId.get(draggedId);
		if (!dragged || dragged.id === target.id || this.subtreeIds(dragged).has(target.id)) return;

		let insertAfter: number;
		let newDepth: number;
		if (zone === "inside") {
			insertAfter = target.lastDescLine; // nest as the target's last child
			newDepth = target.depth + 1;
		} else if (zone === "before") {
			insertAfter = target.line - 1; // land just above the target, same level
			newDepth = target.depth;
		} else {
			insertAfter = target.lastDescLine; // land just below the target's subtree
			newDepth = target.depth;
		}

		await moveNode(this.plugin, model.file, {
			start: dragged.line,
			end: dragged.lastDescLine,
			insertAfter,
			oldDepth: dragged.depth,
			newDepth,
			indentUnit: getIndentUnit(this.plugin.settings),
			bodyStart: model.bodyStart,
		});
	}

	private nodeMenu(e: MouseEvent, node: TaskNode, model: BoardModel): void {
		const menu = new Menu();
		for (const col of model.columns) {
			menu.addItem((i) =>
				i
					.setTitle(`Mark as ${col.name}`)
					.setIcon("check")
					.onClick(() => {
						if (node.isLeaf) void writeStatus(this.plugin, model.file, node.line, col.status);
						else if (col.role === node.derivedRole) void clearOverride(this.plugin, model.file, node.line);
						else void writeOverride(this.plugin, model.file, node.line, col.role, model.columns);
					}),
			);
		}
		menu.addSeparator();
		if (node.override) {
			menu.addItem((i) =>
				i
					.setTitle("Clear manual override")
					.setIcon("rotate-ccw")
					.onClick(() => void clearOverride(this.plugin, model.file, node.line)),
			);
		}
		menu.addItem((i) =>
			i.setTitle("Move up").setIcon("arrow-up").onClick(() => void this.moveUp(node, model)),
		);
		menu.addItem((i) =>
			i.setTitle("Move down").setIcon("arrow-down").onClick(() => void this.moveDown(node, model)),
		);
		menu.addItem((i) =>
			i.setTitle("Move to end").setIcon("chevrons-down").onClick(() => void this.moveToEnd(node, model)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Indent (make child of previous)")
				.setIcon("indent")
				.onClick(() => void this.indent(node, model)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Outdent")
				.setIcon("outdent")
				.onClick(() => void this.outdent(node, model)),
		);
		menu.addSeparator();
		if (node.children.length > 0) {
			menu.addItem((i) =>
				i
					.setTitle("Open in full focus")
					.setIcon("scan-search")
					.onClick(() => this.startFullFocus(model, node.id)),
			);
			menu.addItem((i) =>
				i
					.setTitle("Focus here (in place)")
					.setIcon("crosshair")
					.onClick(() => this.setFocus(node.id)),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Add subtask").setIcon("plus").onClick(() => void addChildTask(this.plugin, model.file, node)),
		);
		menu.addItem((i) =>
			i.setTitle("Add task below").setIcon("plus").onClick(() => void addSiblingTask(this.plugin, model.file, node)),
		);
		menu.addItem((i) =>
			i.setTitle("Rename…").setIcon("pencil").onClick(() => void this.renamePrompt(node, model)),
		);
		menu.addItem((i) => i.setTitle("Add tag…").setIcon("tag").onClick(() => void this.tagPrompt(node, model)));
		menu.addItem((i) =>
			i.setTitle("Delete task").setIcon("trash").onClick(() => void this.deletePrompt(node, model)),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Open / create note").setIcon("file-text").onClick(() => this.openTaskNote(node, model)),
		);
		menu.addItem((i) =>
			i.setTitle("Reveal in board").setIcon("file").onClick(() => this.openAtLine(model, node.line)),
		);
		menu.showAtMouseEvent(e);
	}

	private async renamePrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const name = await promptText(this.app, { title: "Rename task", initial: node.text, cta: "Rename" });
		if (name) await renameTask(this.plugin, model.file, node, name);
	}

	private async tagPrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const tag = await promptText(this.app, { title: "Add tag", placeholder: "e.g. urgent", cta: "Add tag" });
		if (tag) await addTagTask(this.plugin, model.file, node, tag);
	}

	private async deletePrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const ok =
			node.children.length > 0
				? await confirmModal(this.app, {
						title: "Delete task and its subtasks?",
						body: `"${node.text}" and everything under it will be removed.`,
						cta: "Delete",
					})
				: true;
		if (ok) await deleteTask(this.plugin, model.file, node);
	}
}
