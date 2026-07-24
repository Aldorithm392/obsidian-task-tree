import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import type { TaskNode } from "../model/types.ts";

interface PromptOptions {
	title: string;
	initial?: string;
	placeholder?: string;
	cta?: string;
}

/** A one-line text prompt. Resolves to the trimmed value, or null if cancelled/empty. */
export function promptText(app: App, opts: PromptOptions): Promise<string | null> {
	return new Promise((resolve) => new PromptModal(app, opts, resolve).open());
}

class PromptModal extends Modal {
	private opts: PromptOptions;
	private resolve: (value: string | null) => void;
	private value: string;
	private submitted = false;

	constructor(app: App, opts: PromptOptions, resolve: (value: string | null) => void) {
		super(app);
		this.opts = opts;
		this.resolve = resolve;
		this.value = opts.initial ?? "";
	}

	override onOpen(): void {
		this.titleEl.setText(this.opts.title);
		new Setting(this.contentEl).addText((t) => {
			t.setValue(this.value).setPlaceholder(this.opts.placeholder ?? "");
			t.onChange((v) => (this.value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.opts.cta ?? "OK")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private submit(): void {
		this.submitted = true;
		const v = this.value.trim();
		this.resolve(v.length > 0 ? v : null);
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) this.resolve(null);
	}
}

export interface TaskChoice {
	node: TaskNode;
	label: string;
}

/** A fuzzy picker over the board's tasks (used to choose a dependency target). */
export function pickTask(app: App, placeholder: string, choices: TaskChoice[], onPick: (node: TaskNode) => void): void {
	new TaskPickModal(app, placeholder, choices, onPick).open();
}

class TaskPickModal extends FuzzySuggestModal<TaskChoice> {
	private choices: TaskChoice[];
	private onPick: (node: TaskNode) => void;

	constructor(app: App, placeholder: string, choices: TaskChoice[], onPick: (node: TaskNode) => void) {
		super(app);
		this.choices = choices;
		this.onPick = onPick;
		this.setPlaceholder(placeholder);
	}

	getItems(): TaskChoice[] {
		return this.choices;
	}

	getItemText(c: TaskChoice): string {
		return c.label;
	}

	onChooseItem(c: TaskChoice): void {
		this.onPick(c.node);
	}
}

interface ConfirmOptions {
	title: string;
	body?: string;
	cta?: string;
	/** Destructive styling on the confirm button (default true — most confirms are deletes). */
	danger?: boolean;
}

/** A yes/no confirm dialog. Resolves true only if the user confirms. */
export function confirmModal(app: App, opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}

class ConfirmModal extends Modal {
	private opts: ConfirmOptions;
	private resolve: (value: boolean) => void;
	private answered = false;

	constructor(app: App, opts: ConfirmOptions, resolve: (value: boolean) => void) {
		super(app);
		this.opts = opts;
		this.resolve = resolve;
	}

	override onOpen(): void {
		this.titleEl.setText(this.opts.title);
		if (this.opts.body) this.contentEl.createEl("p", { text: this.opts.body });
		new Setting(this.contentEl)
			.addButton((b) => {
				b.setButtonText(this.opts.cta ?? "Delete").onClick(() => {
					this.answered = true;
					this.resolve(true);
					this.close();
				});
				if (this.opts.danger === false) b.setCta();
				else b.setWarning();
			})
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.resolve(false);
	}
}
