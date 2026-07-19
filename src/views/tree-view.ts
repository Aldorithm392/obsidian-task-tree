import Sortable from "sortablejs";
import { Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { TaskTreeView, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./base-view.ts";
import type { BoardModel } from "../board-controller.ts";
import { clearOverride, moveNode, writeOverride, writeStatus } from "../board-controller.ts";
import { flatten } from "../model/parser.ts";
import { getIndentUnit } from "../settings.ts";
import type { TaskNode } from "../model/types.ts";
import type TaskTreePlugin from "../main.ts";
import { createOverrideBadge, createProgressBadge, createStatusChip, placementColumn } from "./card.ts";

export class TreeView extends TaskTreeView {
	private collapsed = new Set<string>();
	private focusId: string | null = null;
	private byId = new Map<string, TaskNode>();

	constructor(leaf: WorkspaceLeaf, plugin: TaskTreePlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_TREE;
	}
	getDisplayText(): string {
		return "Task Tree — Tree";
	}
	getIcon(): string {
		return "list-tree";
	}
	protected otherViewType(): string {
		return VIEW_TYPE_KANBAN;
	}

	protected renderBoard(container: HTMLElement, model: BoardModel): void {
		this.buildToolbar(container, model);
		this.byId = new Map(flatten(model.roots).map((n) => [n.id, n]));

		const scroll = container.createDiv({ cls: "tt-tree" });

		let roots = model.roots;
		if (this.focusId) {
			const focus = this.byId.get(this.focusId);
			if (focus) {
				this.renderFocusBar(scroll, focus, model);
				roots = [focus];
			} else {
				this.focusId = null;
			}
		}

		const rootUl = scroll.createEl("ul", { cls: "tt-tree-list tt-root-list" });
		rootUl.dataset.parentId = "";
		rootUl.dataset.parentDepth = "-1";
		rootUl.dataset.parentLine = String(model.bodyStart - 1);
		for (const node of roots) this.renderNode(rootUl, node, model);

		this.setupDnd(scroll, model);
	}

	private renderNode(ul: HTMLElement, node: TaskNode, model: BoardModel): void {
		const li = ul.createEl("li", { cls: "tt-node" });
		li.dataset.id = node.id;
		li.dataset.line = String(node.line);
		li.dataset.subtreeEnd = String(node.lastDescLine);
		li.dataset.depth = String(node.depth);
		li.setAttribute("data-task", node.statusChar);

		const row = li.createDiv({ cls: "tt-row" });
		const hasChildren = node.children.length > 0;

		const toggle = row.createSpan({ cls: "tt-toggle" });
		if (hasChildren) {
			setIcon(toggle, this.collapsed.has(node.id) ? "chevron-right" : "chevron-down");
			this.registerDomEvent(toggle, "click", (e) => {
				e.stopPropagation();
				this.toggleCollapse(node.id);
			});
		} else {
			toggle.addClass("tt-toggle-empty");
		}

		if (node.isTask) {
			const box = row.createEl("input", { type: "checkbox", cls: "tt-checkbox" });
			box.checked = node.effectiveRole === "done";
			this.registerDomEvent(box, "click", (e) => {
				e.preventDefault();
				void this.cycle(node, model);
			});
		}

		const text = row.createSpan({ cls: "tt-node-text", text: node.text || "(untitled)" });
		if (node.effectiveRole === "done") text.addClass("tt-done");
		this.registerDomEvent(text, "click", () => this.openAtLine(model, node.line));

		const meta = row.createDiv({ cls: "tt-node-meta" });
		createStatusChip(meta, node, model.columns);
		createProgressBadge(meta, node);
		if (node.override) createOverrideBadge(meta, node.override);

		if (hasChildren) {
			const focusBtn = meta.createSpan({ cls: "tt-focus-btn", attr: { "aria-label": "Focus on this branch" } });
			setIcon(focusBtn, "scan-search");
			this.registerDomEvent(focusBtn, "click", (e) => {
				e.stopPropagation();
				this.focusId = node.id;
				void this.render();
			});
		}

		this.registerDomEvent(row, "contextmenu", (e) => {
			e.preventDefault();
			this.nodeMenu(e, node, model);
		});

		if (hasChildren && !this.collapsed.has(node.id)) {
			const childUl = li.createEl("ul", { cls: "tt-tree-list" });
			childUl.dataset.parentId = node.id;
			childUl.dataset.parentDepth = String(node.depth);
			childUl.dataset.parentLine = String(node.line);
			for (const child of node.children) this.renderNode(childUl, child, model);
		}
	}

	private renderFocusBar(container: HTMLElement, node: TaskNode, model: BoardModel): void {
		const bar = container.createDiv({ cls: "tt-focus-bar" });
		const exit = bar.createEl("button", { cls: "tt-btn", text: "All tasks" });
		this.registerDomEvent(exit, "click", () => {
			this.focusId = null;
			void this.render();
		});
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
			this.registerDomEvent(crumb, "click", () => {
				this.focusId = anc.id;
				void this.render();
			});
		}
		bar.createSpan({ cls: "tt-focus-sep", text: "›" });
		bar.createSpan({ cls: "tt-focus-current", text: node.text || "…" });
	}

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
		if (!prev) return; // nothing to indent under
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
		if (!node.parentId) return; // already at root
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

	private subtreeIds(node: TaskNode): Set<string> {
		const ids = new Set<string>();
		const walk = (n: TaskNode): void => {
			ids.add(n.id);
			for (const c of n.children) walk(c);
		};
		walk(node);
		return ids;
	}

	private setupDnd(scroll: HTMLElement, model: BoardModel): void {
		const lists = scroll.querySelectorAll<HTMLElement>(".tt-tree-list");
		lists.forEach((list) => {
			Sortable.create(list, {
				group: "tt-tree",
				animation: 150,
				fallbackOnBody: true,
				swapThreshold: 0.6,
				draggable: ".tt-node",
				ghostClass: "tt-ghost",
				filter: ".tt-toggle, .tt-checkbox, .tt-chip, .tt-focus-btn",
				onEnd: (evt) => void this.onDrop(evt, model),
			});
		});
	}

	private async onDrop(evt: Sortable.SortableEvent, model: BoardModel): Promise<void> {
		try {
			const li = evt.item as HTMLElement;
			const id = li.dataset.id;
			if (!id) return;
			const node = this.byId.get(id);
			if (!node) return;

			const toUl = evt.to as HTMLElement;
			const newParentId = toUl.dataset.parentId ? toUl.dataset.parentId : null;

			// Never drop a branch inside itself.
			if (newParentId && this.subtreeIds(node).has(newParentId)) {
				await this.render();
				return;
			}

			const newParentDepth = Number(toUl.dataset.parentDepth ?? "-1");
			const newDepth = newParentDepth + 1;

			const prev = li.previousElementSibling as HTMLElement | null;
			let insertAfter: number;
			if (prev && prev.dataset.subtreeEnd) {
				insertAfter = Number(prev.dataset.subtreeEnd);
			} else {
				insertAfter = Number(toUl.dataset.parentLine ?? String(model.bodyStart - 1));
			}
			if (!Number.isFinite(insertAfter)) insertAfter = model.bodyStart - 1;

			await moveNode(this.plugin, model.file, {
				start: node.line,
				end: node.lastDescLine,
				insertAfter,
				oldDepth: node.depth,
				newDepth,
				indentUnit: getIndentUnit(this.plugin.settings),
				bodyStart: model.bodyStart,
			});
		} catch {
			await this.render();
		}
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
					.setTitle("Focus on this branch")
					.setIcon("scan-search")
					.onClick(() => {
						this.focusId = node.id;
						void this.render();
					}),
			);
		}
		menu.addItem((i) =>
			i
				.setTitle("Open note")
				.setIcon("file")
				.onClick(() => this.openAtLine(model, node.line)),
		);
		menu.showAtMouseEvent(e);
	}
}
