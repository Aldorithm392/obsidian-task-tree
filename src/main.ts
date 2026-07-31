import { Notice, Plugin, TFile, type App } from "obsidian";
import { DEFAULT_SETTINGS, TaskTreeSettingTab, type TaskTreeSettings } from "./settings.ts";
import { KanbanView } from "./views/kanban-view.ts";
import { TreeView } from "./views/tree-view.ts";
import { DashboardView } from "./views/dashboard-view.ts";
import { TaskTreeView, VIEW_TYPE_DASHBOARD, VIEW_TYPE_KANBAN, VIEW_TYPE_TREE } from "./views/base-view.ts";
import { isManagedFrontmatter, MANAGED_TYPE } from "./model/okf.ts";
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
		const answer = await confirmModal(this.app, {
			title: "Teach AI tools about your boards?",
			body:
				"Task Tree can add agent instructions to this vault (an AGENTS.md section and a Claude Code skill) so AI assistants understand and safely edit your boards — no setup on your side, kept up to date automatically. Your own content is never touched.",
			cta: "Add",
			danger: false,
		});
		if (answer === "confirm") {
			this.settings.agentInstructions = "on";
			await this.saveSettings();
			this.agentEnsured = true;
			await ensureAgentInstructions(this);
			new Notice("Added AGENTS.md and the Claude Code skill to this vault.");
		} else if (answer === "reject" && this.settings.agentInstructions === "ask") {
			// Only an explicit Cancel turns into "off". Escape, clicking away, or the modal
			// being torn down by a re-render is "not now" — it used to be recorded as a
			// permanent no, with no notice and nothing pointing back to the setting.
			// A stale modal also can never downgrade an already-accepted "on".
			this.settings.agentInstructions = "off";
			await this.saveSettings();
		} else {
			// Dismissed: leave the setting on "ask" and let the guard re-offer next session.
			this.agentOffered = false;
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

	private activeMdGuard(checking: boolean, run: () => void): boolean {
		const f = this.app.workspace.getActiveFile();
		if (!f || f.extension !== "md") return false;
		if (!checking) run();
		return true;
	}

	async loadSettings(): Promise<void> {
		const stored = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		// Keep only keys the plugin still has. Settings that became FROZEN decisions would
		// otherwise sit in every user's data.json forever, silently re-saved on each change,
		// looking like configuration that does something.
		const known: Record<string, unknown> = {};
		for (const key of Object.keys(DEFAULT_SETTINGS)) {
			if (key in stored) known[key] = stored[key];
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, known as Partial<TaskTreeSettings>);
		// The Miller "columns" layout was removed; a stored value would render as nothing.
		if (this.settings.treeLayout !== "list" && this.settings.treeLayout !== "diagram") {
			this.settings.treeLayout = DEFAULT_SETTINGS.treeLayout;
		}
		if (!Array.isArray(this.settings.columns) || this.settings.columns.length === 0) {
			this.settings.columns = DEFAULT_SETTINGS.columns.map((c) => ({ ...c }));
		}
		// Write the pruned shape back once, so the stale keys actually leave the file.
		if (Object.keys(stored).length !== Object.keys(known).length) await this.saveData(this.settings);
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

	/**
	 * Open the active note in a Task Tree view.
	 *
	 * Deliberately does NOT convert. The opt-in gate is the promise that earns a
	 * Markdown-first user's trust, and this path used to break it on the very first click:
	 * it wrote `type: task-tree` into whatever note happened to be open, and the first
	 * render then appended a `^t-xxxxxx` id to every checklist line — two unrequested
	 * mutations, no question asked, against `docs/00_VISION.md`'s "never surprise the
	 * human's files silently". The view's own `renderNotManaged` screen already asks
	 * properly, so we just let it do its job.
	 */
	private async openForActive(viewType: string): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note first.");
			return;
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

	/**
	 * Opt a note in. Returns false when it declined — a note that already declares a
	 * different `type:` is not ours to reclassify, and the old code silently did nothing
	 * while announcing success, leaving the view's "Make this a board" button dead.
	 */
	private async convert(file: TFile): Promise<boolean> {
		const existingType: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.["type"];
		if (typeof existingType === "string" && existingType !== MANAGED_TYPE) {
			new Notice(
				`"${file.basename}" already declares type: ${existingType}. Task Tree won't change it — remove or edit that key first.`,
				8000,
			);
			return false;
		}
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm["type"] = MANAGED_TYPE;
			if (!fm["title"]) fm["title"] = file.basename;
		});
		new Notice(`"${file.basename}" is now a Task Tree board.`);
		return true;
	}}


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
