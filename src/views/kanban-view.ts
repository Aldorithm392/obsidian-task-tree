import Sortable from "sortablejs";
import { Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { TaskTreeView, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./base-view.ts";
import type { BoardModel } from "../board-controller.ts";
import {
	addChildTask,
	addTagTask,
	clearOverride,
	deleteTask,
	openOrCreateTaskNote,
	renameTask,
	writeOverride,
	writeStatus,
	type TaskNoteMeta,
} from "../board-controller.ts";
import { flatten } from "../model/parser.ts";
import { isDerived } from "../model/rollup.ts";
import type { ColumnDef, TaskNode } from "../model/types.ts";
import type TaskTreePlugin from "../main.ts";
import {
	breadcrumb,
	createBlockedBelowMark,
	createDependencyBadge,
	createNoteProgressBadge,
	createOverrideBadge,
	createProgressBadge,
	dependencyInfo,
	placementColumn,
	renderTaskText,
	roleIcon,
	taskDisplayText,
} from "./card.ts";
import { confirmed, promptText } from "./modals.ts";

export class KanbanView extends TaskTreeView {
	private byId = new Map<string, TaskNode>();

	constructor(leaf: WorkspaceLeaf, plugin: TaskTreePlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_KANBAN;
	}
	getDisplayText(): string {
		return "Task Tree — Kanban";
	}
	getIcon(): string {
		return "layout-dashboard";
	}
	protected otherViewType(): string {
		return VIEW_TYPE_TREE;
	}

	protected renderBoard(container: HTMLElement, model: BoardModel): void {
		this.buildToolbar(container, model);
		const tasks = flatten(model.roots).filter((n) => n.isTask);
		this.byId = new Map(flatten(model.roots).map((n) => [n.id, n]));
		if (this.plugin.settings.showBoardStats) this.renderDashboardHeader(container, model, { compact: true });

		const board = container.createDiv({ cls: "tt-kanban tt-scroll" });
		const lists = new Map<string, HTMLElement>();

		for (const col of model.columns) {
			const count = tasks.filter((n) => placementColumn(n, model.columns)?.id === col.id).length;
			const colEl = board.createDiv({ cls: "tt-column" });
			const head = colEl.createDiv({ cls: "tt-column-head" });
			if (col.color) head.style.setProperty("--tt-col-color", col.color);
			head.createSpan({ cls: "tt-column-name", text: col.name });
			const badge = head.createSpan({ cls: "tt-column-count", text: String(count) });
			if (col.wipLimit && count > col.wipLimit) badge.addClass("tt-wip-over");

			const list = colEl.createDiv({ cls: "tt-column-cards" });
			list.dataset.colId = col.id;
			// An empty column used to be a blank rectangle with nothing to say it accepts a
			// card. The dashed placeholder is the drop affordance; CSS hides it the moment
			// the column holds a card, including mid-drag.
			if (count === 0) {
				list.createDiv({ cls: "tt-column-empty", text: `Drop a task here to mark it ${col.name}` });
			}
			lists.set(col.id, list);
		}

		const fallbackId = model.columns[0]?.id;
		for (const node of tasks) {
			const col = placementColumn(node, model.columns);
			const list = lists.get(col?.id ?? fallbackId ?? "");
			if (list) this.renderCard(list, node, model);
		}

		for (const list of lists.values()) {
			Sortable.create(list, {
				group: "tt-board",
				sort: false,
				animation: 150,
				ghostClass: "tt-ghost",
				draggable: ".tt-card",
				// A parent card is a readout of its children. Dragging one across columns wrote
				// `[tt-override:: done]` — the most natural gesture on a board, silently
				// producing the one thing the format calls an explicit human decision. The card
				// stays visible, with its progress; overriding it now goes through the menu,
				// where the action says its own name.
				filter: ".tt-card.is-derived",
				onEnd: (evt) => void this.onDrop(evt, model),
			});
		}
	}

	private renderCard(list: HTMLElement, node: TaskNode, model: BoardModel): void {
		const card = list.createDiv({ cls: "tt-card" });
		if (isDerived(node)) card.addClass("is-derived");
		card.dataset.id = node.id;
		card.dataset.line = String(node.line);
		// Our own status hook — deliberately NOT `data-task`, which Obsidian's core CSS
		// styles for alternative checkboxes and would repaint our checkboxes.
		card.setAttribute("data-status", node.statusChar);

		breadcrumb(card, this.parentChain(node));
		const main = card.createDiv({ cls: "tt-card-main" });
		const textEl = renderTaskText(
			this.app,
			this,
			main,
			"tt-card-text",
			taskDisplayText(node),
			model.file.path,
		);
		this.registerDomEvent(textEl, "click", (e) => {
			if ((e.target as HTMLElement).closest("a")) return; // links navigate; they don't start an edit
			e.stopPropagation();
			this.startInlineEdit(textEl, node, model);
		});

		const meta = card.createDiv({ cls: "tt-card-meta" });
		if (node.override) createOverrideBadge(meta, node.override);
		createDependencyBadge(meta, node, dependencyInfo(node, model.graph));
		createProgressBadge(meta, node);
		createNoteProgressBadge(meta, node);
		if (isDerived(node)) {
			// Says why the card won't drag, rather than leaving it feeling broken.
			meta.createSpan({
				cls: "tt-parent-tag",
				text: "derived",
				attr: { "aria-label": "This state comes from its subtasks — override it from the right-click menu" },
			});
		}
		createBlockedBelowMark(meta, node);
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
			void addChildTask(this.plugin, model, node).then((l) => this.queueEditAt(l));
		});

		this.registerDomEvent(card, "contextmenu", (e) => {
			e.preventDefault();
			this.cardMenu(e, node, model);
		});
	}

	private parentChain(node: TaskNode): string[] {
		const chain: string[] = [];
		let pid = node.parentId;
		let guard = 0;
		while (pid && guard++ < 20) {
			const p = this.byId.get(pid);
			if (!p) break;
			chain.unshift(taskDisplayText(p) || "…");
			pid = p.parentId;
		}
		return chain.slice(-2);
	}

	private async onDrop(evt: Sortable.SortableEvent, model: BoardModel): Promise<void> {
		if (evt.to === evt.from) return;
		const id = (evt.item).dataset.id;
		const colId = (evt.to).dataset.colId;
		if (!id || !colId) return;
		const node = this.byId.get(id);
		const col = model.columns.find((c) => c.id === colId);
		if (!node || !col) return;
		await this.applyColumn(node, col, model);
	}

	private async applyColumn(node: TaskNode, col: ColumnDef, model: BoardModel): Promise<void> {
		// `!isDerived`, not `!isLeaf`: a task carrying a plain `- note` bullet is not a leaf,
		// but its state is its own and a plain status write is the correct edit.
		if (!isDerived(node)) {
			await writeStatus(this.plugin, model.file, node.line, col.status);
		} else if (col.role === node.derivedRole) {
			await clearOverride(this.plugin, model.file, node.line);
		} else {
			await writeOverride(this.plugin, model.file, node.line, col.role, model.columns);
		}
	}

	private cardMenu(e: MouseEvent, node: TaskNode, model: BoardModel): void {
		const menu = new Menu();
		const derived = isDerived(node);
		for (const col of model.columns) {
			menu.addItem((i) =>
				i
					// Same wording as the tree's menu: the board and the tree are two lenses on
					// one structure, and the same action was called two different things
					// depending on which lens the user happened to be standing in.
					.setTitle(derived ? `Override to ${col.name}` : `Mark as ${col.name}`)
					// One glyph per role: five identical arrows read as one blur.
					.setIcon(roleIcon(col.role))
					.onClick(() => void this.applyColumn(node, col, model)),
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
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Add subtask")
				.setIcon("plus")
				.onClick(() => void addChildTask(this.plugin, model, node).then((l) => this.queueEditAt(l))),
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
		menu.showAtMouseEvent(e);
	}

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
