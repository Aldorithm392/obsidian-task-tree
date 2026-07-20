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
				"These are the default Kanban columns. A board can override them per-file with a tt_columns key in its frontmatter. Each column maps to one checkbox character; roles drive roll-up.",
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
			.setName("Show the stats bar")
			.setDesc("Show per-column counts and the blocked indicator above the tree and board. Off keeps the view clean.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showBoardStats).onChange(async (v) => {
					this.plugin.settings.showBoardStats = v;
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

		new Setting(containerEl).setName("Task notes").setHeading();

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
			for (const e of errors) warn.createEl("div", { text: "⚠ " + e });
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
