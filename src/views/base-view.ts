import {
	ItemView,
	Notice,
	TFile,
	debounce,
	setIcon,
	type Menu,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import type TaskTreePlugin from "../main.ts";
import {
	addRootTask,
	ensureIds,
	loadBoard,
	renameBoard,
	renameTask,
	writeBlockedBy,
	type BoardModel,
} from "../board-controller.ts";
import type { TaskNode } from "../model/types.ts";
import { isManagedFrontmatter, MANAGED_TYPE } from "../model/okf.ts";
import {
	collectBlockers,
	collectDependencyBlocked,
	collectNextUp,
	computeSummary,
	type Insight,
} from "../model/insights.ts";
import { flatten } from "../model/parser.ts";
import { placementColumn, taskDisplayText } from "./card.ts";
import { pickTask, promptText } from "./modals.ts";

export const VIEW_TYPE_KANBAN = "task-tree-kanban";
export const VIEW_TYPE_TREE = "task-tree-tree";
export const VIEW_TYPE_DASHBOARD = "task-tree-dashboard";

/**
 * Shared base for the Kanban and Tree views: owns the bound file, the change
 * subscription, the debounced re-render, and the empty / not-managed states.
 */
export abstract class TaskTreeView extends ItemView {
	plugin: TaskTreePlugin;
	filePath: string | null = null;
	/** True while an inline edit input is open, so a stray re-render can't destroy it. */
	protected editing = false;
	protected readonly rerender: () => void;

	constructor(leaf: WorkspaceLeaf, plugin: TaskTreePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.rerender = debounce(() => {
			if (this.editing) return;
			void this.render();
		}, 150, true);
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), file: this.filePath };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (state && typeof state === "object" && typeof (state as { file?: unknown }).file === "string") {
			this.filePath = (state as { file: string }).file;
		}
		await this.render();
	}

	override async onOpen(): Promise<void> {
		this.registerEvents();
		await this.render();
	}

	protected registerEvents(): void {
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path === this.filePath) this.rerender();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (oldPath === this.filePath && file instanceof TFile) {
					this.filePath = file.path;
					this.rerender();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file.path === this.filePath) {
					this.filePath = null;
					this.rerender();
				}
			}),
		);
	}

	async bind(path: string): Promise<void> {
		this.filePath = path;
		this.app.workspace.requestSaveLayout();
		await this.render();
	}

	protected currentFile(): TFile | null {
		if (!this.filePath) return null;
		const af = this.app.vault.getAbstractFileByPath(this.filePath);
		return af instanceof TFile ? af : null;
	}

	async render(): Promise<void> {
		const c = this.contentEl;
		const prevScroll = c.querySelector<HTMLElement>(".tt-scroll");
		const sx = prevScroll?.scrollLeft ?? 0;
		const sy = prevScroll?.scrollTop ?? 0;
		c.empty();
		c.addClass("tt-view");

		const file = this.currentFile();
		if (!file) {
			this.renderEmpty(c);
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!isManagedFrontmatter(cache?.frontmatter)) {
			this.renderNotManaged(c, file);
			return;
		}
		if (this.plugin.settings.autoAssignIds) {
			const wrote = await ensureIds(this.plugin, file);
			if (wrote) return; // the 'changed' event will trigger a fresh render
		}
		try {
			const model = await loadBoard(this.plugin, file);
			this.renderBoard(c, model);
			const nextScroll = c.querySelector<HTMLElement>(".tt-scroll");
			if (nextScroll) {
				nextScroll.scrollLeft = sx;
				nextScroll.scrollTop = sy;
			}
		} catch (err) {
			this.renderNotice(c, `Could not render board: ${(err as Error).message}`);
		}
	}

	protected abstract renderBoard(container: HTMLElement, model: BoardModel): void;
	protected abstract otherViewType(): string;

	// ---- toolbar & shared affordances ---------------------------------------

	protected buildToolbar(container: HTMLElement, model: BoardModel): HTMLElement {
		const bar = container.createDiv({ cls: "tt-toolbar" });
		const title = bar.createDiv({
			cls: "tt-toolbar-title is-clickable",
			text: this.boardTitle(model),
			attr: { "aria-label": "Rename board" },
		});
		this.registerDomEvent(title, "click", () => void this.promptRenameBoard(model));

		const actions = bar.createDiv({ cls: "tt-toolbar-actions" });
		this.buildToolbarActions(actions, model);
		const add = actions.createEl("button", { cls: "tt-btn", attr: { "aria-label": "Add a task" } });
		setIcon(add, "plus");
		add.createSpan({ text: "Add task" });
		this.registerDomEvent(add, "click", () => void addRootTask(this.plugin, model));
		const swap = actions.createEl("button", { cls: "tt-btn", attr: { "aria-label": "Open the other view" } });
		setIcon(swap, this.otherViewType() === VIEW_TYPE_TREE ? "list-tree" : "layout-dashboard");
		swap.createSpan({ text: this.otherViewType() === VIEW_TYPE_TREE ? "Tree" : "Kanban" });
		this.registerDomEvent(swap, "click", () => {
			if (this.filePath) void this.plugin.activateView(this.otherViewType(), this.filePath);
		});
		return bar;
	}

	/** Hook for subclasses to add view-specific toolbar controls (left of the view-swap button). */
	protected buildToolbarActions(_actions: HTMLElement, _model: BoardModel): void {
		// base: no controls
	}

	protected openAtLine(model: BoardModel, line: number): void {
		const leaf = this.app.workspace.getLeaf("tab");
		void leaf.openFile(model.file, { eState: { line } });
	}

	/**
	 * A task's text split for editing: the human edits the visible base; the hidden
	 * own-note [[link]] (when the setting keeps it out of view) is re-appended on save
	 * so an edit can never silently sever the task from its note.
	 */
	protected editableParts(node: TaskNode): { base: string; suffix: string } {
		if (this.plugin.settings.showTaskNoteLink || !node.ownNoteLink) {
			return { base: node.text, suffix: "" };
		}
		return {
			base: node.text.replace(/\s*\[\[[^\]]+\]\]\s*$/, "").trim(),
			suffix: ` [[${node.ownNoteLink}]]`,
		};
	}

	/** Edit a task's text in place: swap the text span for an input; Enter/blur saves, Esc cancels. */
	protected startInlineEdit(textEl: HTMLElement, node: TaskNode, model: BoardModel): void {
		if (this.editing) return;
		const parent = textEl.parentElement;
		if (!parent) return;
		this.editing = true;

		const { base, suffix } = this.editableParts(node);
		const input = parent.createEl("input", { cls: "tt-inline-input" });
		input.type = "text";
		input.value = base;
		parent.insertBefore(input, textEl);
		textEl.remove();
		input.focus();
		input.select();

		let settled = false;
		const finish = (commit: boolean): void => {
			if (settled) return;
			settled = true;
			this.editing = false;
			if (commit) {
				const value = input.value.trim();
				if (value.length > 0 && value !== base) {
					void renameTask(this.plugin, model.file, node, value + suffix);
					return; // the write triggers a fresh re-render
				}
			}
			this.rerender();
		};

		this.registerDomEvent(input, "keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});
		this.registerDomEvent(input, "blur", () => finish(true));
	}

	/** "Blocked by…" + "Clear dependencies" — shared by every view's context menu. */
	protected addDependencyMenuItems(menu: Menu, node: TaskNode, model: BoardModel): void {
		if (!node.isTask) return;
		menu.addItem((i) =>
			i.setTitle("Blocked by…").setIcon("link").onClick(() => this.pickDependency(node, model)),
		);
		if (node.blockedBy.length > 0) {
			menu.addItem((i) =>
				i
					.setTitle("Clear dependencies")
					.setIcon("unlink")
					.onClick(() => void writeBlockedBy(this.plugin, model.file, node.line, [])),
			);
		}
	}

	/** Fuzzy-pick another task; choosing one toggles it in this task's blocked-by list. */
	private pickDependency(node: TaskNode, model: BoardModel): void {
		const candidates = flatten(model.roots).filter((t) => t.isTask && t.hasStoredId && t.id !== node.id);
		if (candidates.length === 0) {
			new Notice("No other tasks have block IDs yet — run 'Assign block IDs' first.");
			return;
		}
		const choices = candidates.map((t) => ({
			node: t,
			label: `${node.blockedBy.includes(t.id) ? "✓ " : ""}${taskDisplayText(t) || t.id}`,
		}));
		pickTask(this.app, "Pick the task this one waits on (pick again to remove)", choices, (target) => {
			const has = node.blockedBy.includes(target.id);
			const ids = has ? node.blockedBy.filter((x) => x !== target.id) : [...node.blockedBy, target.id];
			void writeBlockedBy(this.plugin, model.file, node.line, ids);
		});
	}

	protected boardTitle(model: BoardModel): string {
		const t: unknown = this.app.metadataCache.getFileCache(model.file)?.frontmatter?.title;
		return typeof t === "string" && t.length > 0 ? t : model.file.basename;
	}

	/** Prompt for a new board name (the project goal) and write it to the frontmatter title. */
	protected async promptRenameBoard(model: BoardModel): Promise<void> {
		const name = await promptText(this.app, {
			title: "Rename board",
			initial: this.boardTitle(model),
			cta: "Rename",
		});
		if (name) {
			await renameBoard(this.plugin, model.file, name);
			this.rerender();
		}
	}

	/** The dashboard strip: board title (rename on click), add-task, per-column counts, blocked flag. */
	protected renderDashboardHeader(container: HTMLElement, model: BoardModel, opts: { compact?: boolean } = {}): void {
		const head = container.createDiv({ cls: "tt-dash-header" });

		const row = head.createDiv({ cls: "tt-dash-titlerow" });
		const title = row.createEl(opts.compact ? "span" : "h2", {
			cls: "tt-dash-title",
			text: this.boardTitle(model),
			attr: { "aria-label": "Rename board" },
		});
		this.registerDomEvent(title, "click", () => void this.promptRenameBoard(model));
		const add = row.createEl("button", { cls: "tt-btn", attr: { "aria-label": "Add a task" } });
		setIcon(add, "plus");
		add.createSpan({ text: "Add task" });
		this.registerDomEvent(add, "click", () => void addRootTask(this.plugin, model));

		const tasks = flatten(model.roots).filter((n) => n.isTask);
		const stats = head.createDiv({ cls: "tt-dash-stats" });
		for (const col of model.columns) {
			const count = tasks.filter((n) => placementColumn(n, model.columns)?.id === col.id).length;
			const pill = stats.createSpan({ cls: "tt-stat" });
			pill.setAttribute("data-role", col.role);
			pill.createSpan({ cls: "tt-stat-n", text: String(count) });
			pill.createSpan({ cls: "tt-stat-l", text: col.name });
		}
		const summary = computeSummary(model.roots);
		const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
		const prog = stats.createSpan({ cls: "tt-stat tt-stat-progress" });
		prog.createSpan({ cls: "tt-stat-n", text: `${pct}%` });
		prog.createSpan({ cls: "tt-stat-l", text: "done" });

		const blockers = collectBlockers(model.roots);
		if (blockers.length > 0) {
			const warn = head.createSpan({ cls: "tt-dash-blocked" });
			setIcon(warn, "alert-triangle");
			warn.createSpan({ text: `${blockers.length} blocked` });
			if (opts.compact) {
				warn.addClass("is-clickable");
				this.registerDomEvent(warn, "click", () => {
					if (this.filePath) void this.plugin.activateView(VIEW_TYPE_DASHBOARD, this.filePath);
				});
			}
		}
	}

	/** The blockers + next-up panel — the "what is holding me up" surfacing. */
	protected renderBlockersPanel(container: HTMLElement, model: BoardModel): void {
		const panel = container.createDiv({ cls: "tt-panel" });
		this.renderInsightList(panel, "Blockers", collectBlockers(model.roots), model, "Nothing blocked — clear runway.");
		const held = collectDependencyBlocked(model.roots);
		if (held.length > 0) {
			this.renderInsightList(panel, "Waiting on dependencies", held, model, "");
		}
		this.renderInsightList(panel, "Next up", collectNextUp(model.roots).slice(0, 8), model, "No open tasks.");
	}

	private renderInsightList(
		panel: HTMLElement,
		title: string,
		items: Insight[],
		model: BoardModel,
		empty: string,
	): void {
		const sec = panel.createDiv({ cls: "tt-panel-sec" });
		sec.createDiv({ cls: "tt-panel-title", text: items.length ? `${title} (${items.length})` : title });
		if (items.length === 0) {
			sec.createDiv({ cls: "tt-panel-empty", text: empty });
			return;
		}
		for (const it of items) {
			const rowEl = sec.createDiv({ cls: "tt-panel-item" });
			rowEl.setAttribute("data-role", it.node.effectiveRole);
			if (it.path.length > 0) {
				rowEl.createSpan({ cls: "tt-breadcrumb", text: it.path.map((n) => taskDisplayText(n) || "…").join(" › ") });
			}
			rowEl.createSpan({ cls: "tt-panel-item-text", text: taskDisplayText(it.node) || "(untitled)" });
			this.registerDomEvent(rowEl, "click", () => this.openAtLine(model, it.node.line));
		}
	}

	// ---- placeholder states -------------------------------------------------

	private renderNotice(container: HTMLElement, text: string): void {
		container.createDiv({ cls: "tt-placeholder" }).createDiv({ text });
	}

	private renderEmpty(container: HTMLElement): void {
		const box = container.createDiv({ cls: "tt-placeholder" });
		setIconInto(box, "list-tree");
		box.createEl("h3", { text: "No board open" });
		box.createEl("p", {
			text: "Open a note that has type: task-tree in its frontmatter, or use the current file.",
		});
		const row = box.createDiv({ cls: "tt-placeholder-actions" });
		row.createEl("button", { cls: "tt-btn tt-btn-cta", text: "New board" }).addEventListener("click", () => {
			void this.plugin.createNewBoard();
		});
		row.createEl("button", { cls: "tt-btn", text: "Use current file" }).addEventListener("click", () => {
			void this.useActiveFile();
		});
	}

	private renderNotManaged(container: HTMLElement, file: TFile): void {
		const box = container.createDiv({ cls: "tt-placeholder" });
		setIconInto(box, "sprout");
		box.createEl("h3", { text: `"${file.basename}" is not a Task Tree board yet` });
		box.createEl("p", {
			text: "Task Tree only manages files that opt in with type: task-tree. Add that now?",
		});
		box.createEl("button", { cls: "tt-btn tt-btn-cta", text: "Make this a Task Tree board" }).addEventListener(
			"click",
			() => void this.convertToBoard(file),
		);
	}

	private async useActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note first.");
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!isManagedFrontmatter(cache?.frontmatter)) {
			await this.convertToBoard(file);
		}
		await this.bind(file.path);
	}

	async convertToBoard(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (!fm["type"]) fm["type"] = MANAGED_TYPE;
			if (!fm["title"]) fm["title"] = file.basename;
		});
		await this.bind(file.path);
	}
}

function setIconInto(container: HTMLElement, icon: string): void {
	const el = container.createDiv({ cls: "tt-placeholder-icon" });
	setIcon(el, icon);
}
