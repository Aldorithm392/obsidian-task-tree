import { PluginSettingTab, Setting, type App } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import type { ColumnDef, Role, TreeLayout } from "./model/types.ts";
import { ALL_ROLES } from "./model/types.ts";
import { DEFAULT_COLUMNS, validateColumns } from "./columns.ts";

/**
 * Decisions the plugin makes, so the user doesn't have to.
 *
 * Each of these used to be a setting. None encoded a real disagreement between two
 * reasonable users — they encoded a decision that was hard, offloaded to a dropdown. A
 * setting is not a reversible choice: it is a permanent branch in the code, in the format
 * spec, in the agent contract, in the skill installed inside users' vaults, and in the QA
 * matrix. These are now closed, in one place, with the answer the docs always published.
 */
export const FROZEN = {
	/** Role for a status char no column claims and the published table doesn't name. */
	unknownRole: "doing" as Role,
	/** A blocked child surfaces to its parent — the spec's edge-case table says so. */
	blockedDominates: true,
	/** Block-id shape: `^t-` + 6 base36 chars. Ids are infrastructure, not preference. */
	idPrefix: "t-",
	idLength: 6,
	/**
	 * One tab per level when the plugin must invent indentation. It rarely does: `loadBoard`
	 * DETECTS the unit a file already uses, so an existing board keeps its own style
	 * regardless. This only ever applied to a board with no nesting yet.
	 */
	indentUnit: "\t",
	/**
	 * How many levels of a board are open the first time you see it.
	 *
	 * Roll-up's entire job is to let you NOT look: a collapsed parent reading `2/5` is the
	 * answer to "how is that going". Opening every branch spends the signal the plugin just
	 * finished computing, and turns a 40-task project into 40 rows of noise.
	 *
	 * Not a setting: "Expand all" is one button and it is remembered per board, so the
	 * preference is a gesture rather than a permanent branch in the code.
	 */
	openDepth: 2,
} as const;

export interface TaskTreeSettings {
	columns: ColumnDef[];
	treeLayout: TreeLayout;
	showBoardStats: boolean;
	/** Folder for notes the plugin creates for a task. Empty = next to the board. */
	taskNoteFolder: string;
	/** Folder where the "create new board" command puts new boards. Empty = vault root. */
	newBoardFolder: string;
	/** Keep a task-note's parent/depth/path frontmatter in sync when the task is moved. */
	updateTaskNoteFrontmatter: boolean;
	/** Maintain in-vault agent instructions (AGENTS.md + Claude Code skill): ask once / on / off. */
	agentInstructions: "ask" | "on" | "off";
	/** Show the recursive note-progress badge (checklists inside a task's linked notes). */
	showNoteProgress: boolean;
	/** How many note levels the recursive walk follows. 1 = the task's own note only. */
	noteProgressDepth: number;
	/** Spacing of the tree views: roomy (default) or the older dense packing. */
	treeDensity: "comfortable" | "compact";
	/** Starter tasks written into a brand-new board. One per line; indent to nest. Empty = none. */
	newBoardStarterTasks: string;
	/** Section headings written into a new task-note. Comma-separated. Empty = none. */
	taskNoteSections: string;
}

export const DEFAULT_SETTINGS: TaskTreeSettings = {
	columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
	treeLayout: "list",
	showBoardStats: false,
	taskNoteFolder: "",
	newBoardFolder: "",
	updateTaskNoteFrontmatter: true,
	agentInstructions: "ask",
	showNoteProgress: true,
	noteProgressDepth: 3,
	treeDensity: "comfortable",
	// English defaults, because something has to ship — both are settings precisely so a
	// vault written in another language isn't stuck with them.
	// One subtask starts done, and that single character is the entire tutorial: the first
	// frame of a new board shows "1/2", a half-filled bar, and a parent that is visibly NOT
	// done — roll-up taught by observation in three seconds. The old template marked nothing,
	// so `K/D` never rendered and every new user's first board omitted the one mechanism no
	// competing plugin copies.
	newBoardStarterTasks: "First task\n\t[x] A subtask\n\tAnother subtask\nSecond task",
	taskNoteSections: "Progress, Status, Notes",
};

/**
 * The indentation unit for lines the plugin has to invent from nothing. Boards with any
 * nesting get their own detected unit from `loadBoard` instead, so tabs-vs-spaces was
 * never the user's problem to solve.
 */
export function getIndentUnit(): string {
	return FROZEN.indentUnit;
}

export class TaskTreeSettingTab extends PluginSettingTab {
	plugin: TaskTreePlugin;

	constructor(app: App, plugin: TaskTreePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Columns").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"These are the default Kanban columns. A board can override them per-file with a tt_columns key in its frontmatter. Each column maps to one checkbox character; roles drive roll-up. Color tints the column and its chips; the WIP limit flags a column that holds more cards than it should.",
		});

		this.renderColumns(containerEl);

		new Setting(containerEl).setName("Tree view").setHeading();

		new Setting(containerEl)
			.setName("Default layout")
			.setDesc("How the tree is drawn when a board opens. Each open tree can also be switched from its toolbar.")
			.addDropdown((d) => {
				d.addOption("list", "List (vertical)");
				d.addOption("diagram", "Diagram (horizontal)");
				d.setValue(this.plugin.settings.treeLayout).onChange(async (v) => {
					this.plugin.settings.treeLayout = v as TreeLayout;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Density")
			.setDesc(
				"Comfortable gives the tree room to breathe — larger rows, indent guides, and the diagram's nodes as cards on a canvas. Compact restores the dense packing if you would rather fit more on screen.",
			)
			.addDropdown((d) => {
				d.addOption("comfortable", "Comfortable");
				d.addOption("compact", "Compact");
				d.setValue(this.plugin.settings.treeDensity).onChange(async (v) => {
					this.plugin.settings.treeDensity = v as "comfortable" | "compact";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Show the stats bar")
			.setDesc("Show per-column counts and the blocked indicator above the tree and board. Off keeps the view clean.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showBoardStats).onChange(async (v) => {
					this.plugin.settings.showBoardStats = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Depth (linked notes)").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"A task's own note can carry its own checklists and link to deeper task-notes. Task Tree follows that trail and shows how much work really sits underneath — read-only, computed from the metadata cache, and never folded into a parent's roll-up.",
		});

		new Setting(containerEl)
			.setName("Show note progress")
			.setDesc("Badge a task with the checklist progress found inside its linked notes.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showNoteProgress).onChange(async (v) => {
					this.plugin.settings.showNoteProgress = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("How deep to follow notes")
			.setDesc("1 counts only the task's own note; 2 also counts the task-notes it links to, and so on. A + on the badge means there is more below.")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.noteProgressDepth)
					.onChange(async (v) => {
						this.plugin.settings.noteProgressDepth = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("New boards & task notes").setHeading();

		new Setting(containerEl)
			.setName("New-board folder")
			.setDesc('Folder where "Create a new Task Tree board" puts new boards. Leave empty for the vault root.')
			.addText((t) =>
				t
					.setPlaceholder("e.g. Projects")
					.setValue(this.plugin.settings.newBoardFolder)
					.onChange(async (v) => {
						this.plugin.settings.newBoardFolder = v.replace(/^\/+|\/+$/g, "").trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Task-note folder")
			.setDesc('Folder where "open note for this task" creates notes. Leave empty to create them next to the board.')
			.addText((t) =>
				t
					.setPlaceholder("e.g. Tasks")
					.setValue(this.plugin.settings.taskNoteFolder)
					.onChange(async (v) => {
						this.plugin.settings.taskNoteFolder = v.replace(/^\/+|\/+$/g, "").trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Starter tasks for a new board")
			.setDesc(
				"Written into a brand-new board so it opens with a shape instead of a blank page. One task per line; indent a line to nest it. Leave empty to start every board with no tasks.",
			)
			.addTextArea((t) => {
				t.inputEl.rows = 4;
				t.inputEl.addClass("tt-template-input");
				t.setValue(this.plugin.settings.newBoardStarterTasks).onChange(async (v) => {
					this.plugin.settings.newBoardStarterTasks = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Task-note sections")
			.setDesc(
				'Headings written into a new task-note, comma-separated (e.g. "Progress, Status, Notes"). Leave empty for a note that is just its frontmatter.',
			)
			.addText((t) =>
				t
					.setPlaceholder("Progress, Status, Notes")
					.setValue(this.plugin.settings.taskNoteSections)
					.onChange(async (v) => {
						this.plugin.settings.taskNoteSections = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("AI agents").setHeading();

		new Setting(containerEl)
			.setName("Maintain agent instructions in this vault")
			.setDesc(
				"Adds a managed AGENTS.md section and a Claude Code skill to the vault so AI assistants understand your boards — kept current automatically; your own content is never touched. 'Ask once' offers it the first time a board opens.",
			)
			.addDropdown((d) => {
				d.addOption("ask", "Ask once");
				d.addOption("on", "On");
				d.addOption("off", "Off");
				d.setValue(this.plugin.settings.agentInstructions).onChange(async (v) => {
					this.plugin.settings.agentInstructions = v as "ask" | "on" | "off";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Sync task-note frontmatter on move")
			.setDesc("Reconcile every note's parent / depth / path frontmatter whenever its board renders — edits from any source (this plugin, an AI agent, your editor) self-heal.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.updateTaskNoteFrontmatter).onChange(async (v) => {
					this.plugin.settings.updateTaskNoteFrontmatter = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderColumns(containerEl: HTMLElement): void {
		const cols = this.plugin.settings.columns;

		for (let i = 0; i < cols.length; i++) {
			const col = cols[i];
			if (!col) continue;
			const setting = new Setting(containerEl).setClass("tt-column-row");
			setting.addText((t) =>
				t
					.setPlaceholder("Name")
					.setValue(col.name)
					.onChange(async (v) => {
						col.name = v;
						await this.plugin.saveSettings();
					}),
			);
			setting.addText((t) => {
				t.inputEl.maxLength = 1;
				t.inputEl.addClass("tt-status-input");
				t
					.setPlaceholder("x")
					.setValue(col.status === " " ? "" : col.status)
					.onChange(async (v) => {
						col.status = v === "" ? " " : v.charAt(0);
						await this.plugin.saveSettings();
					});
			});
			setting.addDropdown((d) => {
				for (const r of ALL_ROLES) d.addOption(r, r);
				d.setValue(col.role).onChange(async (v) => {
					col.role = v as Role;
					await this.plugin.saveSettings();
				});
			});
			setting.addColorPicker((c) => {
				// The picker can't be empty, so "no color" = the default falls back at render time.
				if (col.color) c.setValue(col.color);
				c.onChange(async (v) => {
					col.color = v;
					await this.plugin.saveSettings();
				});
			});
			setting.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.inputEl.addClass("tt-wip-input");
				t
					.setPlaceholder("WIP")
					.setValue(col.wipLimit !== undefined ? String(col.wipLimit) : "")
					.onChange(async (v) => {
						const n = Number.parseInt(v, 10);
						if (v.trim() === "") delete col.wipLimit;
						else if (Number.isFinite(n) && n > 0) col.wipLimit = n;
						await this.plugin.saveSettings();
					});
			});
			setting.addExtraButton((b) =>
				b
					.setIcon("eraser")
					.setTooltip("Clear color and WIP limit")
					.onClick(async () => {
						delete col.color;
						delete col.wipLimit;
						await this.plugin.saveSettings();
						this.display();
					}),
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove column")
					.onClick(async () => {
						cols.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		}

		const errors = validateColumns(cols);
		if (errors.length > 0) {
			const warn = containerEl.createDiv({ cls: "tt-settings-warning" });
			for (const e of errors) warn.createDiv({ text: "⚠ " + e });
		}

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add column")
				.setCta()
				.onClick(async () => {
					cols.push({ id: `col-${cols.length + 1}`, name: "New", status: "*", role: "doing" });
					await this.plugin.saveSettings();
					this.display();
				}),
		);
		new Setting(containerEl).addExtraButton((b) =>
			b
				.setIcon("reset")
				.setTooltip("Reset to default columns")
				.onClick(async () => {
					this.plugin.settings.columns = DEFAULT_COLUMNS.map((c) => ({ ...c }));
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}
}
