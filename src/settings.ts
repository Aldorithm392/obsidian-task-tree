import { PluginSettingTab, Setting, type App } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import type { ColumnDef, Role, TreeLayout } from "./model/types.ts";
import { ALL_ROLES } from "./model/types.ts";
import { DEFAULT_COLUMNS, validateColumns } from "./columns.ts";

export interface TaskTreeSettings {
	columns: ColumnDef[];
	unknownRole: Role;
	blockedDominates: boolean;
	indentType: "tabs" | "spaces";
	indentSize: number;
	idPrefix: string;
	idLength: number;
	autoAssignIds: boolean;
	parentAutoSync: boolean;
	maintainTimestamp: boolean;
	treeLayout: TreeLayout;
	showBoardStats: boolean;
	/** Folder for notes the plugin creates for a task. Empty = next to the board. */
	taskNoteFolder: string;
	/** Folder where the "create new board" command puts new boards. Empty = vault root. */
	newBoardFolder: string;
	/** Keep a task-note's parent/depth/path frontmatter in sync when the task is moved. */
	updateTaskNoteFrontmatter: boolean;
	/** Show a task's own [[note]] link on the task line in the views (the file always keeps it). */
	showTaskNoteLink: boolean;
	/** Maintain in-vault agent instructions (AGENTS.md + Claude Code skill): ask once / on / off. */
	agentInstructions: "ask" | "on" | "off";
	/** Checkbox click steps through every column (todo → doing → done → …) instead of toggling done. */
	checkboxCycles: boolean;
	/** Show the recursive note-progress badge (checklists inside a task's linked notes). */
	showNoteProgress: boolean;
	/** How many note levels the recursive walk follows. 1 = the task's own note only. */
	noteProgressDepth: number;
	/** Starter tasks written into a brand-new board. One per line; indent to nest. Empty = none. */
	newBoardStarterTasks: string;
	/** Section headings written into a new task-note. Comma-separated. Empty = none. */
	taskNoteSections: string;
}

export const DEFAULT_SETTINGS: TaskTreeSettings = {
	columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
	unknownRole: "doing",
	blockedDominates: true,
	indentType: "tabs",
	indentSize: 4,
	idPrefix: "t-",
	idLength: 6,
	autoAssignIds: true,
	parentAutoSync: false,
	maintainTimestamp: false,
	treeLayout: "list",
	showBoardStats: false,
	taskNoteFolder: "",
	newBoardFolder: "",
	updateTaskNoteFrontmatter: true,
	showTaskNoteLink: false,
	checkboxCycles: false,
	agentInstructions: "ask",
	showNoteProgress: true,
	noteProgressDepth: 3,
	// English defaults, because something has to ship — both are settings precisely so a
	// vault written in another language isn't stuck with them.
	newBoardStarterTasks: "First task\n\tA subtask\nSecond task",
	taskNoteSections: "Progress, Status, Notes",
};

/** The indentation unit used when the plugin writes moved or new lines. */
export function getIndentUnit(settings: TaskTreeSettings): string {
	return settings.indentType === "tabs" ? "\t" : " ".repeat(Math.max(1, settings.indentSize));
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

		new Setting(containerEl).setName("Roll-up").setHeading();

		new Setting(containerEl)
			.setName("Unknown status role")
			.setDesc("Role assigned to a checkbox character that no column claims.")
			.addDropdown((d) => {
				for (const r of ALL_ROLES) d.addOption(r, r);
				d.setValue(this.plugin.settings.unknownRole).onChange(async (v) => {
					this.plugin.settings.unknownRole = v as Role;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Blocked surfaces to parent")
			.setDesc("When on, a blocked child makes its parent read as blocked.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.blockedDominates).onChange(async (v) => {
					this.plugin.settings.blockedDominates = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Tree view").setHeading();

		new Setting(containerEl)
			.setName("Default layout")
			.setDesc("How the tree is drawn when a board opens. Each open tree can also be switched from its toolbar.")
			.addDropdown((d) => {
				d.addOption("list", "List (vertical)");
				d.addOption("diagram", "Diagram (horizontal)");
				d.addOption("columns", "Columns (drill-down)");
				d.setValue(this.plugin.settings.treeLayout).onChange(async (v) => {
					this.plugin.settings.treeLayout = v as TreeLayout;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Checkbox steps through every column")
			.setDesc(
				"When on, clicking a task's checkbox cycles To Do → Doing → Done → … When off (default), one click simply toggles Done — other states stay reachable from the Kanban board and the right-click menu.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.checkboxCycles).onChange(async (v) => {
					this.plugin.settings.checkboxCycles = v;
					await this.plugin.saveSettings();
				}),
			);

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

		new Setting(containerEl).setName("Writing").setHeading();

		new Setting(containerEl)
			.setName("Indentation")
			.setDesc("The unit used when the plugin writes moved or new task lines.")
			.addDropdown((d) => {
				d.addOption("tabs", "Tab");
				d.addOption("spaces", "Spaces");
				d.setValue(this.plugin.settings.indentType).onChange(async (v) => {
					this.plugin.settings.indentType = v as "tabs" | "spaces";
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.indentType === "spaces") {
			new Setting(containerEl).setName("Spaces per level").addText((t) =>
				t
					.setValue(String(this.plugin.settings.indentSize))
					.onChange(async (v) => {
						const n = Number.parseInt(v, 10);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.indentSize = n;
							await this.plugin.saveSettings();
						}
					}),
			);
		}

		new Setting(containerEl)
			.setName("Auto-assign block IDs")
			.setDesc("Give every task in a managed board a stable ^id (written once).")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoAssignIds).onChange(async (v) => {
					this.plugin.settings.autoAssignIds = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Block ID prefix")
			.setDesc("Namespaces Task Tree ids so they are greppable, e.g. t- gives ^t-a1b2c3.")
			.addText((t) =>
				t.setValue(this.plugin.settings.idPrefix).onChange(async (v) => {
					this.plugin.settings.idPrefix = v.replace(/[^A-Za-z0-9-]/g, "");
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Maintain OKF timestamp")
			.setDesc("Update the board's frontmatter timestamp on each change (adds churn to git).")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.maintainTimestamp).onChange(async (v) => {
					this.plugin.settings.maintainTimestamp = v;
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

		new Setting(containerEl)
			.setName("Show the note link on the task line")
			.setDesc(
				"When off (default), a task's own [[note]] link is hidden in the views so the title doesn't appear twice — the Markdown file always keeps the link, and the note stays reachable from the file icon and the right-click menu.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTaskNoteLink).onChange(async (v) => {
					this.plugin.settings.showTaskNoteLink = v;
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
