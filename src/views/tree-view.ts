import { Menu, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { TaskTreeView, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./base-view.ts";
import type { BoardModel } from "../board-controller.ts";
import {
	addChildTask,
	addRootTask,
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
import { isDerived } from "../model/rollup.ts";
import { isFolded } from "../model/folding.ts";
import { ALL_ROLES, type TaskNode, type TreeLayout } from "../model/types.ts";
import type TaskTreePlugin from "../main.ts";
import {
	createBlockedBelowMark,
	createDependencyBadge,
	createNoteProgressBadge,
	createOverrideBadge,
	createProgressBadge,
	createStatusChip,
	dependencyInfo,
	renderTaskText,
	roleIcon,
	roleLabel,
	taskDisplayText,
} from "./card.ts";
import { boardLanes, canonicalStatusForRole } from "../columns.ts";
import { FROZEN } from "../settings.ts";
import { confirmed, promptText } from "./modals.ts";

interface RowOptions {
	toggle: "collapse" | "drill" | "none";
	editTrigger: "click" | "dblclick";
}

/** How one layout exposes its focusable rows to the shared keyboard handler. */
interface KeyboardSpec {
	/** Selector for the focusable row elements, matched in document order. */
	rowSelector: string;
	/** The task id a row belongs to. */
	idOf: (row: HTMLElement) => string;
	/** Find the row for a task id inside the rendered container. */
	rowFor: (container: HTMLElement, id: string) => HTMLElement | null;
}

interface LocalRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/**
 * A box's rect in the canvas's OWN layout coordinates, walked from the offset chain.
 *
 * Deliberately NOT getBoundingClientRect: the inverted diagram mirrors the canvas with
 * `transform: scaleX(-1)`, and the SVG overlay lives *inside* that transform. Screen
 * coordinates are post-transform, so feeding them back into the overlay drew every
 * dependency curve horizontally flipped — pointing at the wrong tasks — whenever the
 * invert toggle was on. Offsets are pre-transform, so one set of maths is right in both
 * orientations. Returns null if the element isn't laid out (a collapsed branch).
 */
function localRect(el: HTMLElement, canvas: HTMLElement): LocalRect | null {
	let x = 0;
	let y = 0;
	let e: HTMLElement | null = el;
	while (e && e !== canvas) {
		x += e.offsetLeft;
		y += e.offsetTop;
		e = e.offsetParent as HTMLElement | null;
	}
	if (e !== canvas) return null; // never reached the canvas — not rendered
	const width = el.offsetWidth;
	const height = el.offsetHeight;
	return { left: x, top: y, right: x + width, bottom: y + height, width, height };
}

export class TreeView extends TaskTreeView {
	/**
	 * Folding is tri-state, and it has to be. A board opens `FROZEN.openDepth` levels deep,
	 * so "not in the collapsed set" can no longer mean "open" — otherwise unfolding a branch
	 * would be forgotten the moment the depth default reasserted itself on the next render.
	 * Explicit beats default, in both directions; everything else follows depth.
	 */
	private collapsed = new Set<string>();
	private expanded = new Set<string>();
	private focusId: string | null = null;
	private showDeps = true;
	private layout: TreeLayout;
	private inverted = false;
	private byId = new Map<string, TaskNode>();
	/** Row to re-focus after a keyboard action re-rendered the tree (fold, toggle). */
	private pendingFocusId: string | null = null;
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
		return "Task Tree — Tree";
	}

	/** Is this node's branch hidden? The rule itself lives in the pure layer. */
	private isCollapsed(node: TaskNode): boolean {
		return isFolded(node, {
			openDepth: FROZEN.openDepth,
			collapsed: this.collapsed,
			expanded: this.expanded,
			// Depth counts from whatever the view is rooted at. Focusing a branch and then
			// hiding it because it sits deep in the board would answer "show me this" with
			// one row.
			baseDepth: this.focusDepth(),
		});
	}

	/** Depth of the current view root: 0 for a whole board, the focused node's depth otherwise. */
	private focusDepth(): number {
		if (!this.focusId) return 0;
		return this.byId.get(this.focusId)?.depth ?? 0;
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
			showDeps: this.showDeps,
			// Only stable ^ids survive a reload; synthetic L<line> keys shift with any edit.
			// BOTH sets persist: with a depth default, "explicitly opened" is as much a
			// decision as "explicitly closed" and is lost just as easily.
			collapsed: [...this.collapsed].filter((id) => !/^L\d+$/.test(id)),
			expanded: [...this.expanded].filter((id) => !/^L\d+$/.test(id)),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const s = state as Partial<{
				layout: TreeLayout;
				inverted: boolean;
				focusId: string | null;
				collapsed: string[];
				expanded: string[];
				showDeps: boolean;
			}>;
			if (s.layout === "list" || s.layout === "diagram") this.layout = s.layout;
			if (typeof s.inverted === "boolean") this.inverted = s.inverted;
			if (typeof s.focusId === "string" || s.focusId === null) this.focusId = s.focusId ?? null;
			if (Array.isArray(s.collapsed)) {
				this.collapsed = new Set(s.collapsed.filter((x): x is string => typeof x === "string"));
			}
			if (Array.isArray(s.expanded)) {
				this.expanded = new Set(s.expanded.filter((x): x is string => typeof x === "string"));
			}
			if (typeof s.showDeps === "boolean") this.showDeps = s.showDeps;
		}
		await super.setState(state, result);
	}

	protected buildToolbarActions(actions: HTMLElement, model: BoardModel): void {
		const group = actions.createDiv({ cls: "tt-layout-switch" });
		const defs: Array<[TreeLayout, string, string]> = [
			["list", "list", "List"],
			["diagram", "git-fork", "Diagram"],
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

		if (this.layout === "diagram") {
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

		// The escape hatch for the depth default, and the answer to "where did my tasks go".
		// One button, both directions, remembered per board — so "I want it all open" is a
		// gesture the plugin honours rather than a setting it has to carry forever.
		const folded = this.anythingFolded(model);
		const foldAll = actions.createEl("button", {
			cls: "tt-layout-btn",
			attr: { "aria-label": folded ? "Expand every branch" : "Collapse every branch" },
		});
		setIcon(foldAll, folded ? "chevrons-up-down" : "chevrons-down-up");
		this.registerDomEvent(foldAll, "click", () => this.setAllFolded(model, !folded));

		if (this.layout === "diagram") {
			const deps = actions.createEl("button", {
				cls: "tt-layout-btn tt-deps-btn",
				attr: { "aria-label": "Show dependency edges (tt-blocked-by) between tasks" },
			});
			setIcon(deps, "link");
			if (this.showDeps) deps.addClass("is-active");
			this.registerDomEvent(deps, "click", () => {
				this.showDeps = !this.showDeps;
				this.app.workspace.requestSaveLayout();
				void this.render();
			});
		}
	}

	protected renderBoard(container: HTMLElement, model: BoardModel): void {
		// Before the toolbar: the fold-all button asks isCollapsed which way to point, and
		// isCollapsed resolves the focused node through `byId`.
		this.prepareModel(model);
		this.buildToolbar(container, model);
		if (this.plugin.settings.showBoardStats) {
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

		if (focusNode) this.renderFocusBar(scroll, focusNode, model);

		if (roots.length === 0) {
			this.renderEmptyBoard(scroll, model);
			return;
		}

		if (this.layout === "diagram") this.renderDiagram(scroll, roots, model);
		else this.renderList(scroll, roots, model);
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
			setIcon(toggle, this.isCollapsed(node) ? "chevron-right" : "chevron-down");
			this.registerDomEvent(toggle, "click", (e) => {
				e.stopPropagation();
				this.toggleCollapse(node);
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
			box.indeterminate = node.effectiveRole === "doing"; // native "in progress" dash
			// A derived parent's checkbox is a READOUT, not a control. Clicking it used to
			// write `[tt-override:: done]` — silently, with no confirmation and without ever
			// saying the word "override" — which is the exact thing AGENTS.md forbids agents
			// from doing, and it undermined the one promise the product is built on: that a
			// parent cannot lie about being complete.
			if (isDerived(node)) {
				box.addClass("is-derived");
				box.setAttribute("aria-label", "Derived from this task's children");
			}
			this.registerDomEvent(box, "click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				void this.cycle(node, model);
			});
		}

		const text = renderTaskText(
			this.app,
			this,
			host,
			"tt-node-text",
			taskDisplayText(node),
			model.file.path,
		);
		if (node.effectiveRole === "done") text.addClass("tt-done");
		// Cancelled is out of the flow, like done, but it is not an achievement — it reads as
		// set aside rather than struck off, so a scan down the tree doesn't count it as work
		// finished. The row treatment is what lets cancelled exist without a Kanban lane.
		if (node.effectiveRole === "cancelled") host.addClass("is-cancelled");
		this.registerDomEvent(text, opts.editTrigger, (e) => {
			if ((e.target as HTMLElement).closest("a")) return; // links navigate; they don't start an edit
			e.stopPropagation();
			this.startInlineEdit(text, node, model);
		});

		const meta = host.createDiv({ cls: "tt-node-meta" });
		createStatusChip(meta, node, model.columns);
		createProgressBadge(meta, node);
		createNoteProgressBadge(meta, node);
		if (node.override) createOverrideBadge(meta, node.override);
		createDependencyBadge(meta, node, dependencyInfo(node, model.graph));
		createBlockedBelowMark(meta, node);

		const noteBtn = meta.createSpan({ cls: "tt-row-btn tt-note-btn", attr: { "aria-label": "Open / create the task's note" } });
		if (node.ownNoteLink) noteBtn.addClass("has-note"); // stays faintly visible: this task has a note
		setIcon(noteBtn, "file-text");
		this.registerDomEvent(noteBtn, "click", (e) => {
			e.stopPropagation();
			this.openTaskNote(node, model);
		});

		const addBtn = meta.createSpan({ cls: "tt-row-btn tt-add-btn", attr: { "aria-label": "Add subtask" } });
		setIcon(addBtn, "plus");
		this.registerDomEvent(addBtn, "click", (e) => {
			e.stopPropagation();
			void addChildTask(this.plugin, model, node).then((l) => this.queueEditAt(l));
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
		rootUl.setAttribute("role", "tree");
		rootUl.setAttribute("aria-label", "Tasks");
		for (const node of roots) this.renderListNode(rootUl, node, model);
		this.wireTreeKeyboard(rootUl, model, TreeView.LIST_KEYS);
	}

	private renderListNode(ul: HTMLElement, node: TaskNode, model: BoardModel): void {
		const li = ul.createEl("li", { cls: "tt-node" });
		li.dataset.id = node.id;
		li.dataset.line = String(node.line);
		li.dataset.subtreeEnd = String(node.lastDescLine);
		li.dataset.depth = String(node.depth);
		li.setAttribute("data-status", node.statusChar); // not `data-task`: Obsidian core styles that attr
		li.setAttribute("role", "none"); // the ROW is the treeitem; the li is just structure

		const row = li.createDiv({ cls: "tt-row" });
		row.setAttribute("role", "treeitem");
		row.setAttribute("aria-level", String(node.depth + 1));
		if (node.children.length > 0) row.setAttribute("aria-expanded", String(!this.isCollapsed(node)));
		// Roving tabindex: the tree is ONE tab stop, the arrows do the walking.
		row.tabIndex = -1;
		this.buildRowContent(row, node, model, {
			toggle: "collapse",
			editTrigger: "click",
		});

		if (node.children.length > 0 && !this.isCollapsed(node)) {
			const childUl = li.createEl("ul", { cls: "tt-tree-list" });
			childUl.dataset.parentId = node.id;
			childUl.dataset.parentDepth = String(node.depth);
			childUl.dataset.parentLine = String(node.line);
			childUl.setAttribute("role", "group");
			for (const child of node.children) this.renderListNode(childUl, child, model);
		}
	}

	/**
	 * What one layout's rows look like to the keyboard layer. The list and the diagram
	 * differ only in which element is the row and how it carries its id — the walking,
	 * folding and editing are identical, so they share one handler.
	 */
	private static readonly LIST_KEYS: KeyboardSpec = {
		rowSelector: ".tt-row",
		idOf: (row) => row.parentElement?.dataset.id ?? "",
		rowFor: (c, id) => c.querySelector<HTMLElement>(`.tt-node[data-id="${CSS.escape(id)}"] > .tt-row`),
	};

	private static readonly DIAGRAM_KEYS: KeyboardSpec = {
		// Scoped to boxes that carry a task: the project goal box has no data-id.
		rowSelector: ".tt-dnode[data-id] > .tt-dbox",
		idOf: (row) => row.parentElement?.dataset.id ?? "",
		rowFor: (c, id) => c.querySelector<HTMLElement>(`.tt-dnode[data-id="${CSS.escape(id)}"] > .tt-dbox`),
	};

	/**
	 * The keyboard path — the one thing the views had no answer for. Arrows walk the
	 * visible rows, ← / → fold and unfold, Enter edits in place, Space toggles done, and
	 * Alt+arrows restructure (the context menu's move/indent/outdent, without the menu).
	 * Actions that rewrite the file re-render, so the row to land on afterwards is
	 * remembered in `pendingFocusId` and re-focused on the way back.
	 */
	private wireTreeKeyboard(container: HTMLElement, model: BoardModel, spec: KeyboardSpec): void {
		const visibleRows = (): HTMLElement[] =>
			Array.from(container.querySelectorAll<HTMLElement>(spec.rowSelector));

		this.landFocus(visibleRows()[0], (id) => spec.rowFor(container, id));

		this.registerDomEvent(container, "keydown", (e: KeyboardEvent) => {
			const row = this.keyboardRow(e, container, spec.rowSelector);
			if (!row) return;
			const node = this.byId.get(spec.idOf(row));
			if (!node) return;

			const rows = visibleRows();
			const idx = rows.indexOf(row);
			const moveTo = (to: HTMLElement | null | undefined): void => {
				if (!to) return;
				e.preventDefault();
				row.tabIndex = -1;
				to.tabIndex = 0;
				to.focus();
				to.scrollIntoView({ block: "nearest" });
			};
			const fold = (): void => {
				e.preventDefault();
				this.pendingFocusId = node.id; // come back to this row after the re-render
				this.toggleCollapse(node);
			};

			// Alt+arrows restructure. Checked first: they share the arrow keys with
			// navigation, and a restructure must never also move the focus.
			if (e.altKey && this.handleStructureKey(e, node, model)) return;
			if (this.handleSharedKey(e, row, node, model)) return;

			switch (e.key) {
				case "ArrowDown":
					moveTo(rows[idx + 1]);
					return;
				case "ArrowUp":
					moveTo(rows[idx - 1]);
					return;
				case "ArrowRight":
					// Closed branch opens; anything else steps to the next row.
					if (node.children.length > 0 && this.isCollapsed(node)) fold();
					else moveTo(rows[idx + 1]);
					return;
				case "ArrowLeft":
					// Open branch closes; a leaf climbs to its parent.
					if (node.children.length > 0 && !this.isCollapsed(node)) fold();
					else if (node.parentId) moveTo(spec.rowFor(container, node.parentId));
					return;
				default:
					return;
			}
		});
	}

	/** The focusable row an event came from, or null when the keys aren't ours to take. */
	private keyboardRow(e: KeyboardEvent, container: HTMLElement, rowSelector: string): HTMLElement | null {
		const el = e.target as HTMLElement | null;
		// While an inline edit is open the input owns every key, Escape included.
		// `instanceOf` rather than `instanceof`: a popped-out window has its own
		// HTMLInputElement, and the bare operator would miss it.
		if (!el || el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) return null;
		const row = el.closest<HTMLElement>(rowSelector);
		return row && container.contains(row) ? row : null;
	}

	/** Give the layout one tab stop, and restore focus after a re-render that moved it. */
	private landFocus(
		fallback: HTMLElement | null | undefined,
		rowFor: (id: string) => HTMLElement | null,
	): void {
		const wanted = this.pendingFocusId;
		this.pendingFocusId = null;
		const landing = (wanted ? rowFor(wanted) : null) ?? fallback;
		if (!landing) return;
		landing.tabIndex = 0;
		if (wanted) landing.focus();
	}

	/** Keys that mean the same thing in every layout: edit, toggle, open the menu. */
	private handleSharedKey(e: KeyboardEvent, row: HTMLElement, node: TaskNode, model: BoardModel): boolean {
		if (e.key === "Enter") {
			const textEl = row.querySelector<HTMLElement>(".tt-node-text");
			if (!textEl) return false;
			e.preventDefault();
			this.startInlineEdit(textEl, node, model);
			return true;
		}
		if (e.key === " ") {
			if (!node.isTask) return false;
			e.preventDefault(); // Space on a focusable element would page-scroll
			this.pendingFocusId = node.id;
			void this.cycle(node, model);
			return true;
		}
		// The menu key (and its Shift+F10 twin) is the keyboard's right-click: without it,
		// everything only the context menu offers stays mouse-only.
		if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
			e.preventDefault();
			const r = row.getBoundingClientRect();
			this.buildNodeMenu(node, model).showAtPosition({ x: r.left + 16, y: r.bottom });
			return true;
		}
		return false;
	}

	/** Alt+arrows: the restructure actions, straight from the keyboard. */
	private handleStructureKey(e: KeyboardEvent, node: TaskNode, model: BoardModel): boolean {
		const run = (op: Promise<void>): true => {
			e.preventDefault();
			this.pendingFocusId = node.id; // follow the task, not the position
			void op;
			return true;
		};
		switch (e.key) {
			case "ArrowUp":
				return run(this.moveUp(node, model));
			case "ArrowDown":
				return run(this.moveDown(node, model));
			case "ArrowRight":
				return run(this.indent(node, model));
			case "ArrowLeft":
				return run(this.outdent(node, model));
			default:
				return false;
		}
	}

	/** A board with no tasks — a legitimate state now that the starter template can be empty. */
	private renderEmptyBoard(scroll: HTMLElement, model: BoardModel): void {
		const box = scroll.createDiv({ cls: "tt-empty-board" });
		box.createDiv({ cls: "tt-empty-board-text", text: "No tasks on this board yet." });
		const btn = box.createEl("button", { cls: "tt-btn tt-btn-cta", text: "Add the first task" });
		this.registerDomEvent(btn, "click", () =>
			void addRootTask(this.plugin, model).then((l) => this.queueEditAt(l)),
		);
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
			this.wireTreeKeyboard(canvas, model, TreeView.DIAGRAM_KEYS);
			this.scheduleDependencyOverlay(canvas, model);
			return;
		}
		const gnode = canvas.createDiv({ cls: "tt-dnode" });
		const gbox = gnode.createDiv({ cls: "tt-dbox tt-goal-box" });
		this.buildGoalContent(gbox, model);
		if (roots.length > 0) {
			const kids = gnode.createDiv({ cls: "tt-dchildren" });
			for (const node of roots) this.renderDiagramNode(kids, node, model);
		}
		this.wireTreeKeyboard(canvas, model, TreeView.DIAGRAM_KEYS);
		this.scheduleDependencyOverlay(canvas, model);
	}

	/** Draw the tt-blocked-by edges once the diagram has a layout to measure. */
	private scheduleDependencyOverlay(canvas: HTMLElement, model: BoardModel): void {
		if (!this.showDeps || model.graph.edges.length === 0) return;
		window.requestAnimationFrame(() => {
			if (!canvas.isConnected) return; // a re-render replaced this diagram
			this.drawDependencyEdges(canvas, model);
		});
	}

	/**
	 * An absolutely-positioned SVG overlay on the diagram: one dashed curve per
	 * dependency, drawn from the enabling task to the one waiting on it. Distinct
	 * from the solid CSS hierarchy connectors; orientation-agnostic because it uses
	 * measured positions (so the inverted layout needs no special casing).
	 */
	private drawDependencyEdges(canvas: HTMLElement, model: BoardModel): void {
		const SVG_NS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.classList.add("tt-dep-svg");
		svg.setAttribute("width", String(canvas.scrollWidth));
		svg.setAttribute("height", String(canvas.scrollHeight));

		const boxOf = (id: string): LocalRect | null => {
			const dnode = canvas.querySelector(`.tt-dnode[data-id="${CSS.escape(id)}"]`);
			const box = dnode?.querySelector(":scope > .tt-dbox");
			return box instanceof HTMLElement ? localRect(box, canvas) : null;
		};

		let drawn = 0;
		for (const e of model.graph.edges) {
			const from = boxOf(e.to.id); // arrow starts at the enabling task…
			const to = boxOf(e.from.id); // …and points at the task waiting on it
			if (!from || !to) continue; // collapsed / focused out of view

			// Anchor by the REAL gap between boxes, not by centers: overlapping-on-an-axis
			// pairs (a parent and its stacked child) must anchor on the other axis, or the
			// control points loop the curve straight through the boxes.
			const gapRight = to.left - from.right; // to sits right of from
			const gapLeft = from.left - to.right; // to sits left of from
			const gapDown = to.top - from.bottom; // to sits below from
			const gapUp = from.top - to.bottom; // to sits above from
			const hGap = Math.max(gapRight, gapLeft);
			const vGap = Math.max(gapDown, gapUp);
			let d: string;
			let x2: number;
			let y2: number;
			if (hGap >= vGap && hGap > -8) {
				const ltr = gapRight >= gapLeft;
				const x1 = ltr ? from.right : from.left;
				const y1 = from.top + from.height / 2;
				x2 = ltr ? to.left : to.right;
				y2 = to.top + to.height / 2;
				const bend = Math.min(80, Math.max(12, Math.abs(x2 - x1) / 2));
				const c1 = ltr ? x1 + bend : x1 - bend;
				const c2 = ltr ? x2 - bend : x2 + bend;
				d = `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
			} else {
				const ttb = gapDown >= gapUp;
				const x1 = from.left + from.width / 2;
				const y1 = ttb ? from.bottom : from.top;
				x2 = to.left + to.width / 2;
				y2 = ttb ? to.top : to.bottom;
				const bend = Math.min(60, Math.max(10, Math.abs(y2 - y1) / 2));
				const c1 = ttb ? y1 + bend : y1 - bend;
				const c2 = ttb ? y2 - bend : y2 + bend;
				d = `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
			}

			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", d);
			path.classList.add("tt-dep-edge");
			const released = e.to.effectiveRole === "done" || e.to.effectiveRole === "cancelled";
			if (!released) path.classList.add("is-held");
			if (model.graph.cycleIds.has(e.from.id) && model.graph.cycleIds.has(e.to.id)) {
				path.classList.add("is-cycle");
			}
			svg.appendChild(path);

			const dot = document.createElementNS(SVG_NS, "circle");
			dot.setAttribute("cx", String(x2));
			dot.setAttribute("cy", String(y2));
			dot.setAttribute("r", "3");
			dot.classList.add("tt-dep-dot");
			if (!released) dot.classList.add("is-held");
			svg.appendChild(dot);
			drawn += 1;
		}
		if (drawn > 0) canvas.appendChild(svg);
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
			indentUnit: model.indentUnit,
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
		box.setAttribute("data-status", node.statusChar); // not `data-task`: Obsidian core styles that attr
		box.setAttribute("data-role", node.effectiveRole); // drives the card's status edge
		box.tabIndex = -1; // roving tabindex, same contract as the list layout
		this.buildRowContent(box, node, model, {
			toggle: "collapse",
			editTrigger: "click",
		});
		// isCollapsed, not `collapsed.has` — the depth default is part of the rule, and the
		// chevron above already reads it. Bypassing it here is how the diagram ended up
		// drawing an open branch under a chevron pointing right.
		if (node.children.length > 0 && !this.isCollapsed(node)) {
			const kids = dnode.createDiv({ cls: "tt-dchildren" });
			kids.dataset.parentId = node.id;
			kids.dataset.parentDepth = String(node.depth);
			kids.dataset.parentLine = String(node.line);
			for (const child of node.children) this.renderDiagramNode(kids, child, model);
		}
	}

	// ---- task notes ----------------------------------------------------------
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
	/** Change the in-place focus — now the ONE scoping mechanism in the view. */
	private setFocus(id: string | null): void {
		this.focusId = id;
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
		bar.createSpan({ cls: "tt-focus-current", text: taskDisplayText(node) || "…" });
	}

	// ---- interactions --------------------------------------------------------

	private toggleCollapse(node: TaskNode): void {
		// Record the DECISION, not just the flip: a node folded by the depth default and one
		// folded by hand look identical to `collapsed`, but only the second should survive a
		// re-render that recomputes depth.
		if (this.isCollapsed(node)) {
			this.collapsed.delete(node.id);
			this.expanded.add(node.id);
		} else {
			this.expanded.delete(node.id);
			this.collapsed.add(node.id);
		}
		this.app.workspace.requestSaveLayout();
		void this.render();
	}

	/** Open or fold the whole board in one gesture — the escape hatch for the depth default. */
	private setAllFolded(model: BoardModel, folded: boolean): void {
		this.collapsed.clear();
		this.expanded.clear();
		for (const n of flatten(model.roots)) {
			if (n.children.length === 0) continue;
			if (folded) this.collapsed.add(n.id);
			else this.expanded.add(n.id);
		}
		this.app.workspace.requestSaveLayout();
		void this.render();
	}

	/** True when some branch is currently hidden — decides which way the toolbar button goes. */
	private anythingFolded(model: BoardModel): boolean {
		return flatten(model.roots).some((n) => n.children.length > 0 && this.isCollapsed(n));
	}

	private cycle(node: TaskNode, model: BoardModel): Promise<void> {
		// `!isDerived`, not `isLeaf`: a task carrying a plain `- note` bullet is not a leaf,
		// but its state is still its own and its checkbox must keep working.
		if (!isDerived(node)) {
			// A checkbox is a checkbox: one click toggles done. Stepping through every column
			// was an opt-in setting that made the most familiar control in the product mean
			// something no other checkbox in Obsidian means. Other states live on the Kanban
			// board, in the context menu, and on Alt+arrows.
			const role = node.effectiveRole === "done" ? "todo" : "done";
			return writeStatus(this.plugin, model.file, node.line, canonicalStatusForRole(role, model.columns));
		}
		// Derived: explain instead of writing. The override still exists and is one
		// right-click away — but it now happens through a gesture that names itself.
		this.explainDerived(node);
		return Promise.resolve();
	}

	/** Say why this checkbox didn't move, and where the deliberate version lives. */
	private explainDerived(node: TaskNode): void {
		const title = taskDisplayText(node) || "This task";
		const { done, total } = node.progress;
		const state = node.override
			? `is overridden to ${roleLabel(node.override)}`
			: `follows its children — ${done} of ${total} done`;
		new Notice(`"${title}" ${state}. Finish the subtasks, or right-click to override it.`, 6000);
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
			indentUnit: model.indentUnit,
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
			indentUnit: model.indentUnit,
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
			indentUnit: model.indentUnit,
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
			indentUnit: model.indentUnit,
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
			indentUnit: model.indentUnit,
			bodyStart: model.bodyStart,
		});
	}

	private nodeMenu(e: MouseEvent, node: TaskNode, model: BoardModel): void {
		this.buildNodeMenu(node, model).showAtMouseEvent(e);
	}

	/** The node context menu, built but not shown — the keyboard opens it by position. */
	private buildNodeMenu(node: TaskNode, model: BoardModel): Menu {
		const menu = new Menu();
		const derived = isDerived(node);
		// Every ROLE, not every column — see the same loop in kanban-view.ts. Which lanes a
		// board draws is a layout choice; it was never meant to decide which states a task is
		// allowed to be in, and on a default board that quietly withheld cancelled entirely.
		for (const col of boardLanes(model.columns, ALL_ROLES)) {
			menu.addItem((i) =>
				i
					// A derived node cannot simply "be" a state — saying so means overriding what
					// its children add up to. The label says which one you're doing, because a
					// gesture that quietly writes `[tt-override:: done]` is the failure this
					// whole product exists to prevent.
					.setTitle(derived ? `Override to ${col.name}` : `Mark as ${col.name}`)
					// One glyph per role: five identical check marks read as one blur.
					.setIcon(roleIcon(col.role))
					.onClick(() => {
						if (!derived) void writeStatus(this.plugin, model.file, node.line, col.status);
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
			// One focus, in place. "Open in full focus" opened a second scoping mechanism in a
			// new tab whose title was identical for every task — focus five parents while
			// exploring and you had five tabs called "Task Tree — Focus".
			menu.addItem((i) =>
				i
					.setTitle("Focus on this branch")
					.setIcon("scan-search")
					.onClick(() => this.setFocus(node.id)),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Add subtask")
				.setIcon("plus")
				.onClick(() => void addChildTask(this.plugin, model, node).then((l) => this.queueEditAt(l))),
		);
		menu.addItem((i) =>
			i
				.setTitle("Add task below")
				.setIcon("plus")
				.onClick(() => void addSiblingTask(this.plugin, model, node).then((l) => this.queueEditAt(l))),
		);
		menu.addItem((i) =>
			i.setTitle("Rename…").setIcon("pencil").onClick(() => void this.renamePrompt(node, model)),
		);
		menu.addItem((i) => i.setTitle("Add tag…").setIcon("tag").onClick(() => void this.tagPrompt(node, model)));
		menu.addItem((i) =>
			i.setTitle("Delete task").setIcon("trash").onClick(() => void this.deletePrompt(node, model)),
		);
		menu.addSeparator();
		this.addDependencyMenuItems(menu, node, model);
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Open / create note").setIcon("file-text").onClick(() => this.openTaskNote(node, model)),
		);
		menu.addItem((i) =>
			i.setTitle("Reveal in board").setIcon("file").onClick(() => this.openAtLine(model, node.line)),
		);
		return menu;
	}

	private async renamePrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const { base, suffix } = this.editableParts(node);
		const name = await promptText(this.app, { title: "Rename task", initial: base, cta: "Rename" });
		if (name && name !== base) await renameTask(this.plugin, model.file, node, name + suffix);
	}

	private async tagPrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const tag = await promptText(this.app, { title: "Add tag", placeholder: "e.g. urgent", cta: "Add tag" });
		if (tag) await addTagTask(this.plugin, model.file, node, tag);
	}

	private async deletePrompt(node: TaskNode, model: BoardModel): Promise<void> {
		const ok =
			node.children.length > 0
				? await confirmed(this.app, {
						title: "Delete task and its subtasks?",
						body: `"${taskDisplayText(node)}" and everything under it will be removed.`,
						cta: "Delete",
					})
				: true;
		if (ok) await deleteTask(this.plugin, model.file, node);
	}
}
