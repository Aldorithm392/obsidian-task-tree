import { Notice, Plugin, TFile, normalizePath, type App } from "obsidian";
import { DEFAULT_SETTINGS, TaskTreeSettingTab, type TaskTreeSettings } from "./settings.ts";
import { KanbanView } from "./views/kanban-view.ts";
import { TreeView } from "./views/tree-view.ts";
import { DashboardView } from "./views/dashboard-view.ts";
import { TaskTreeView, VIEW_TYPE_DASHBOARD, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./views/base-view.ts";
import { appendLogEntry, buildIndexMd, isManagedFrontmatter, MANAGED_TYPE } from "./model/okf.ts";
import { assignIdsInText } from "./model/writer.ts";
import { createBoardFile, reconcileBoardNotes } from "./board-controller.ts";
import { ensureAgentInstructions } from "./agent-setup.ts";
import { AccentFuzzyModal, confirmModal, promptText } from "./views/modals.ts";

export default class TaskTreePlugin extends Plugin {
	settings: TaskTreeSettings = DEFAULT_SETTINGS;
	/** Once-per-session guards for the agent-instructions machinery. */
	private agentOffered = false;
	private agentEnsured = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_KANBAN, (leaf) => new KanbanView(leaf, this));
		this.registerView(VIEW_TYPE_TREE, (leaf) => new TreeView(leaf, this));
		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
		this.addSettingTab(new TaskTreeSettingTab(this.app, this));

		// Keep every Task Tree leaf bound when its board file is moved or renamed.
		// The view instances handle this themselves, but Obsidian DEFERS background
		// tabs (the view never instantiates), so their serialized state would keep
		// pointing at the old path and come back as "No board open". Patching the
		// leaf state at the plugin level covers deferred and live leaves alike.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				for (const type of [VIEW_TYPE_KANBAN, VIEW_TYPE_TREE, VIEW_TYPE_DASHBOARD]) {
					for (const leaf of this.app.workspace.getLeavesOfType(type)) {
						const vs = leaf.getViewState();
						const state = vs.state;
						if (state && state["file"] === oldPath) {
							state["file"] = file.path;
							void leaf.setViewState(vs);
						}
					}
				}
			}),
		);

		this.addRibbonIcon("list-tree", "Open Task Tree", () => {
			void this.openForActive(VIEW_TYPE_TREE);
		});

		this.addCommand({
			id: "open-dashboard",
			name: "Open current file as dashboard",
			checkCallback: (checking) => this.activeMdGuard(checking, () => void this.openForActive(VIEW_TYPE_DASHBOARD)),
		});
		this.addCommand({
			id: "open-kanban",
			name: "Open current file as Kanban board",
			checkCallback: (checking) => this.activeMdGuard(checking, () => void this.openForActive(VIEW_TYPE_KANBAN)),
		});
		this.addCommand({
			id: "open-tree",
			name: "Open current file as tree",
			checkCallback: (checking) => this.activeMdGuard(checking, () => void this.openForActive(VIEW_TYPE_TREE)),
		});
		this.addCommand({
			id: "new-board",
			name: "Create a new board",
			callback: () => void this.createNewBoard(),
		});
		this.addCommand({
			id: "convert-to-board",
			name: "Convert current file to a board",
			checkCallback: (checking) => this.activeMdGuard(checking, () => void this.convertActive()),
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
			id: "add-task",
			name: "Add a task to the open board",
			// Bindable to a hotkey: capture without reaching for the mouse, which is half
			// of the keyboard-only path (the tree's arrow navigation is the other half).
			checkCallback: (checking) => {
				const view = this.openBoardView();
				if (!view) return false;
				if (!checking) void view.addTaskFromCommand();
				return true;
			},
		});
		this.addCommand({
			id: "open-picker",
			name: "Open a board…",
			callback: () => new BoardPicker(this.app, this).open(),
		});
		this.addCommand({
			id: "build-index",
			name: "Build the boards index (index.md)",
			callback: () => void this.buildIndexCommand(),
		});
		this.addCommand({
			id: "append-log",
			name: "Append an entry to the boards log (log.md)",
			callback: () => void this.appendLogCommand(),
		});
		this.addCommand({
			id: "resync-task-notes",
			name: "Resync all task-note frontmatter",
			callback: () => void this.resyncTaskNotesCommand(),
		});
	}

	/** Reconcile every board's task-notes right now (agent / manual escape hatch). */
	private async resyncTaskNotesCommand(): Promise<void> {
		let healed = 0;
		const boards = this.managedBoards();
		for (const f of boards) healed += await reconcileBoardNotes(this, f);
		new Notice(
			healed > 0
				? `Resynced ${healed} task-note${healed === 1 ? "" : "s"} across ${boards.length} board${boards.length === 1 ? "" : "s"}.`
				: "All task-note frontmatter is already in sync.",
		);
	}

	/**
	 * The vault teaches the agent: with consent given once, the plugin maintains
	 * AGENTS.md + a Claude Code skill inside the vault, silently and forever.
	 * Called whenever a managed board renders.
	 */
	async maybeOfferAgentSetup(): Promise<void> {
		const mode = this.settings.agentInstructions;
		if (mode === "off") return;
		if (mode === "on") {
			if (this.agentEnsured) return;
			this.agentEnsured = true;
			await ensureAgentInstructions(this);
			return;
		}
		// mode === "ask": offer exactly once per session, remember the answer forever.
		if (this.agentOffered) return;
		this.agentOffered = true;
		const ok = await confirmModal(this.app, {
			title: "Teach AI tools about your boards?",
			body:
				"Task Tree can add agent instructions to this vault (an AGENTS.md section and a Claude Code skill) so AI assistants understand and safely edit your boards — no setup on your side, kept up to date automatically. Your own content is never touched.",
			cta: "Add",
			danger: false,
		});
		if (ok) {
			this.settings.agentInstructions = "on";
			await this.saveSettings();
			this.agentEnsured = true;
			await ensureAgentInstructions(this);
			new Notice("Added AGENTS.md and the Claude Code skill to this vault.");
		} else if (this.settings.agentInstructions === "ask") {
			// Only a live "ask" turns into "off" — a stale modal (e.g. after a plugin
			// reload raced a second instance) can never downgrade an accepted "on".
			this.settings.agentInstructions = "off";
			await this.saveSettings();
		}
	}

	/**
	 * The Task Tree view a command should act on: the focused one if the user is in it,
	 * otherwise the first one open anywhere (a tree parked in a sidebar still counts).
	 */
	private openBoardView(): TaskTreeView | null {
		const active = this.app.workspace.getActiveViewOfType(TreeView) ?? this.app.workspace.getActiveViewOfType(KanbanView);
		if (active?.filePath) return active;
		for (const type of [VIEW_TYPE_TREE, VIEW_TYPE_DASHBOARD, VIEW_TYPE_KANBAN]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.view instanceof TaskTreeView && leaf.view.filePath) return leaf.view;
			}
		}
		return null;
	}

	/** Every managed board in the vault (frontmatter `type: task-tree`). */
	managedBoards(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				isManagedFrontmatter(
					this.app.metadataCache.getFileCache(f)?.frontmatter,
				),
			);
	}

	/** Regenerate the OKF `index.md` bundle file: one link per managed board. */
	private async buildIndexCommand(): Promise<void> {
		const dir = this.settings.newBoardFolder;
		const indexPath = normalizePath(dir ? `${dir}/index.md` : "index.md");
		const entries = this.managedBoards()
			.map((f) => {
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
				const title = typeof fm?.["title"] === "string" && fm["title"] ? (fm["title"]) : f.basename;
				const description = typeof fm?.["description"] === "string" ? (fm["description"]) : undefined;
				return { path: relPath(dir, f.path), title, description };
			})
			.sort((a, b) => a.title.localeCompare(b.title));
		const content = buildIndexMd(entries);
		await this.writeBundleFile(indexPath, () => content, (d) => (d === content ? d : content));
		new Notice(`Indexed ${entries.length} board${entries.length === 1 ? "" : "s"} in ${indexPath}.`);
	}

	/** Prompt for a line and prepend it to the OKF `log.md` under today's date. */
	private async appendLogCommand(): Promise<void> {
		const entry = await promptText(this.app, {
			title: "Log entry",
			placeholder: "What happened?",
			cta: "Add to log",
		});
		if (!entry) return;
		const dir = this.settings.newBoardFolder;
		const logPath = normalizePath(dir ? `${dir}/log.md` : "log.md");
		const date = new Date().toISOString().slice(0, 10);
		await this.writeBundleFile(logPath, () => appendLogEntry("", date, entry), (d) => appendLogEntry(d, date, entry));
		new Notice(`Logged under ${date} in ${logPath}.`);
	}

	/** Create (or update, via vault.process) a bundle file, making its folder first if needed. */
	private async writeBundleFile(
		path: string,
		create: () => string,
		update: (existing: string) => string,
	): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, update);
			return;
		}
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
			try {
				await this.app.vault.createFolder(dir);
			} catch {
				// already exists / race — ignore
			}
		}
		await this.app.vault.create(path, create());
	}

	private activeMdGuard(checking: boolean, run: () => void): boolean {
		const f = this.app.workspace.getActiveFile();
		if (!f || f.extension !== "md") return false;
		if (!checking) run();
		return true;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<TaskTreeSettings> | null);
		if (!Array.isArray(this.settings.columns) || this.settings.columns.length === 0) {
			this.settings.columns = DEFAULT_SETTINGS.columns.map((c) => ({ ...c }));
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	refreshViews(): void {
		// Dashboard included: it has its own view type, so it used to sit out every
		// settings change and keep rendering stale badges and counts.
		for (const type of [VIEW_TYPE_KANBAN, VIEW_TYPE_TREE, VIEW_TYPE_DASHBOARD]) {
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

	/** Open a task + its subtree as a distraction-free full pane in the main area. */
	async activateFocusView(filePath: string, focusId: string): Promise<void> {
		const { workspace } = this.app;
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_TREE,
			active: true,
			state: { file: filePath, focusId, fullFocus: true },
		});
		void workspace.revealLeaf(leaf);
	}

	private async openForActive(viewType: string): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note first.");
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (!isManagedFrontmatter(cache?.frontmatter)) {
			await this.convert(file);
		}
		await this.activateView(viewType, file.path);
	}

	private async convertActive(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (file) await this.convert(file);
	}

	/** Prompt for a name, create a fresh board file, and open it in the tree view. */
	async createNewBoard(): Promise<void> {
		const name = await promptText(this.app, {
			title: "New Task Tree board",
			placeholder: "Project name",
			cta: "Create board",
		});
		if (!name) return;
		try {
			const file = await createBoardFile(this, name, this.settings.newBoardFolder);
			await this.activateView(VIEW_TYPE_TREE, file.path);
			new Notice(`Created board "${file.basename}".`);
		} catch (err) {
			new Notice(`Could not create board: ${(err as Error).message}`);
		}
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

/** Vault path of `to`, relative to the folder `fromDir` ("" = vault root). */
function relPath(fromDir: string, to: string): string {
	if (!fromDir) return to;
	const from = fromDir.split("/");
	const parts = to.split("/");
	let i = 0;
	while (i < from.length && from[i] === parts[i]) i++;
	return [...(Array(from.length - i).fill("..") as string[]), ...parts.slice(i)].join("/");
}

class BoardPicker extends AccentFuzzyModal<TFile> {
	private plugin: TaskTreePlugin;

	constructor(app: App, plugin: TaskTreePlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("Pick a Task Tree board");
	}

	getItems(): TFile[] {
		return this.plugin.managedBoards();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void this.plugin.activateView(VIEW_TYPE_KANBAN, file.path);
	}
}
