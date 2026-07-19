import { FuzzySuggestModal, Notice, Plugin, TFile, type App } from "obsidian";
import { DEFAULT_SETTINGS, TaskTreeSettingTab, type TaskTreeSettings } from "./settings.ts";
import {
	KanbanView,
} from "./views/kanban-view.ts";
import { TreeView } from "./views/tree-view.ts";
import { TaskTreeView, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./views/base-view.ts";
import { isManagedFrontmatter, MANAGED_TYPE } from "./model/okf.ts";
import { assignIdsInText } from "./model/writer.ts";

export default class TaskTreePlugin extends Plugin {
	settings: TaskTreeSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_KANBAN, (leaf) => new KanbanView(leaf, this));
		this.registerView(VIEW_TYPE_TREE, (leaf) => new TreeView(leaf, this));
		this.addSettingTab(new TaskTreeSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Open Task Tree board", () => {
			void this.openForActive(VIEW_TYPE_KANBAN);
		});

		this.addCommand({
			id: "open-kanban",
			name: "Open current file as Kanban board",
			checkCallback: (checking) => this.activeMdGuard(checking, () => this.openForActive(VIEW_TYPE_KANBAN)),
		});
		this.addCommand({
			id: "open-tree",
			name: "Open current file as tree",
			checkCallback: (checking) => this.activeMdGuard(checking, () => this.openForActive(VIEW_TYPE_TREE)),
		});
		this.addCommand({
			id: "convert-to-board",
			name: "Convert current file to a Task Tree board",
			checkCallback: (checking) => this.activeMdGuard(checking, () => this.convertActive()),
		});
		this.addCommand({
			id: "assign-ids",
			name: "Assign block IDs to all tasks in current file",
			checkCallback: (checking) =>
				this.activeMdGuard(checking, () => {
					const f = this.app.workspace.getActiveFile();
					if (f) void this.assignIdsCommand(f);
				}),
		});
		this.addCommand({
			id: "open-picker",
			name: "Open a Task Tree board…",
			callback: () => new BoardPicker(this.app, this).open(),
		});
	}

	private activeMdGuard(checking: boolean, run: () => void): boolean {
		const f = this.app.workspace.getActiveFile();
		if (!f || f.extension !== "md") return false;
		if (!checking) run();
		return true;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!Array.isArray(this.settings.columns) || this.settings.columns.length === 0) {
			this.settings.columns = DEFAULT_SETTINGS.columns.map((c) => ({ ...c }));
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	refreshViews(): void {
		for (const type of [VIEW_TYPE_KANBAN, VIEW_TYPE_TREE]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view;
				if (view instanceof TaskTreeView) void view.render();
			}
		}
	}

	async activateView(viewType: string, filePath: string): Promise<void> {
		const { workspace } = this.app;
		let leaf =
			workspace
				.getLeavesOfType(viewType)
				.find((l) => l.view instanceof TaskTreeView && l.view.filePath === filePath) ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: viewType, active: true, state: { file: filePath } });
		}
		void workspace.revealLeaf(leaf);
	}

	private async openForActive(viewType: string): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note first.");
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!isManagedFrontmatter(cache?.frontmatter as Record<string, unknown> | undefined)) {
			await this.convert(file);
		}
		await this.activateView(viewType, file.path);
	}

	private async convertActive(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (file) await this.convert(file);
	}

	private async convert(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (!fm["type"]) fm["type"] = MANAGED_TYPE;
			if (!fm["title"]) fm["title"] = file.basename;
		});
		new Notice(`"${file.basename}" is now a Task Tree board.`);
	}

	private async assignIdsCommand(file: TFile): Promise<void> {
		let assigned = 0;
		await this.app.vault.process(file, (data) => {
			const res = assignIdsInText(data, { prefix: this.settings.idPrefix, length: this.settings.idLength });
			assigned = res.assigned;
			return res.text;
		});
		new Notice(assigned > 0 ? `Assigned ${assigned} block id${assigned === 1 ? "" : "s"}.` : "All tasks already have ids.");
	}
}

class BoardPicker extends FuzzySuggestModal<TFile> {
	private plugin: TaskTreePlugin;

	constructor(app: App, plugin: TaskTreePlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("Pick a Task Tree board");
	}

	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				isManagedFrontmatter(
					this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined,
				),
			);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void this.plugin.activateView(VIEW_TYPE_KANBAN, file.path);
	}
}
