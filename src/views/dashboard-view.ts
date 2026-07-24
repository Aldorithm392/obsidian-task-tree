import { TreeView } from "./tree-view.ts";
import { VIEW_TYPE_DASHBOARD, VIEW_TYPE_KANBAN } from "./base-view.ts";
import type { BoardModel } from "../board-controller.ts";

/**
 * The dedicated project dashboard: the full header + the blockers/next-up panel on
 * top, then the task tree (in whichever layout is chosen) beneath. Reuses all of
 * TreeView's rendering, layouts, full-focus, and editing.
 */
export class DashboardView extends TreeView {
	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return "Task Tree — dashboard";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	protected otherViewType(): string {
		return VIEW_TYPE_KANBAN;
	}

	protected renderBoard(container: HTMLElement, model: BoardModel): void {
		this.buildToolbar(container, model);
		this.prepareModel(model);
		this.renderDashboardHeader(container, model);
		this.renderBlockersPanel(container, model);
		const scroll = container.createDiv({ cls: "tt-tree tt-scroll" });
		this.renderTreeBody(scroll, model);
	}
}
