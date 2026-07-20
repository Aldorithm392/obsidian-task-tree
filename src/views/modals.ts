import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";

/** Pick one item from a searchable list. Resolves to the item, or null if dismissed. */
export function pickFromList<T>(
	app: App,
	items: T[],
	labelFn: (item: T) => string,
	placeholder = "Search…",
): Promise<T | null> {
	return new Promise((resolve) => new ListPickerModal(app, items, labelFn, placeholder, resolve).open());
}

class ListPickerModal<T> extends FuzzySuggestModal<T> {
	private readonly items: T[];
	private readonly labelFn: (item: T) => string;
	private readonly resolve: (value: T | null) => void;
	private chosen = false;

	constructor(
		app: App,
		items: T[],
		labelFn: (item: T) => string,
		placeholder: string,
		resolve: (value: T | null) => void,
	) {
		super(app);
		this.items = items;
		this.labelFn = labelFn;
		this.resolve = resolve;
		this.setPlaceholder(placeholder);
	}

	getItems(): T[] {
		return this.items;
	}
	getItemText(item: T): string {
		return this.labelFn(item);
	}
	onChooseItem(item: T): void {
		this.chosen = true;
		this.resolve(item);
	}
	override onClose(): void {
		super.onClose();
		if (!this.chosen) this.resolve(null);
	}
}

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

interface ConfirmOptions {
	title: string;
	body?: string;
	cta?: string;
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
			.addButton((b) =>
				b
					.setButtonText(this.opts.cta ?? "Delete")
					.setWarning()
					.onClick(() => {
						this.answered = true;
						this.resolve(true);
						this.close();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.resolve(false);
	}
}
