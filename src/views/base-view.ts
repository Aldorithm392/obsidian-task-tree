import {
	ItemView,
	Notice,
	TFile,
	debounce,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import type TaskTreePlugin from "../main.ts";
import { loadBoard, ensureIds, type BoardModel } from "../board-controller.ts";
import { isManagedFrontmatter, MANAGED_TYPE } from "../model/okf.ts";

export const VIEW_TYPE_KANBAN = "task-tree-kanban";
export const VIEW_TYPE_TREE = "task-tree-tree";

/**
 * Shared base for the Kanban and Tree views: owns the bound file, the change
 * subscription, the debounced re-render, and the empty / not-managed states.
 */
export abstract class TaskTreeView extends ItemView {
	plugin: TaskTreePlugin;
	filePath: string | null = null;
	protected readonly rerender: () => void;

	constructor(leaf: WorkspaceLeaf, plugin: TaskTreePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.rerender = debounce(() => void this.render(), 150, true);
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
		c.empty();
		c.addClass("tt-view");

		const file = this.currentFile();
		if (!file) {
			this.renderEmpty(c);
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!isManagedFrontmatter(cache?.frontmatter as Record<string, unknown> | undefined)) {
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
		} catch (err) {
			this.renderNotice(c, `Could not render board: ${(err as Error).message}`);
		}
	}

	protected abstract renderBoard(container: HTMLElement, model: BoardModel): void;
	protected abstract otherViewType(): string;

	// ---- toolbar & shared affordances ---------------------------------------

	protected buildToolbar(container: HTMLElement, model: BoardModel): HTMLElement {
		const bar = container.createDiv({ cls: "tt-toolbar" });
		const title = typeof this.app.metadataCache.getFileCache(model.file)?.frontmatter?.title === "string"
			? String(this.app.metadataCache.getFileCache(model.file)?.frontmatter?.title)
			: model.file.basename;
		bar.createDiv({ cls: "tt-toolbar-title", text: title });

		const actions = bar.createDiv({ cls: "tt-toolbar-actions" });
		const swap = actions.createEl("button", { cls: "tt-btn", attr: { "aria-label": "Open the other view" } });
		setIcon(swap, this.otherViewType() === VIEW_TYPE_TREE ? "list-tree" : "layout-dashboard");
		swap.createSpan({ text: this.otherViewType() === VIEW_TYPE_TREE ? "Tree" : "Kanban" });
		this.registerDomEvent(swap, "click", () => {
			if (this.filePath) void this.plugin.activateView(this.otherViewType(), this.filePath);
		});
		return bar;
	}

	protected openAtLine(model: BoardModel, line: number): void {
		const leaf = this.app.workspace.getLeaf("tab");
		void leaf.openFile(model.file, { eState: { line } });
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
		box.createEl("button", { cls: "tt-btn", text: "Use current file" }).addEventListener("click", () => {
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
		if (!isManagedFrontmatter(cache?.frontmatter as Record<string, unknown> | undefined)) {
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
