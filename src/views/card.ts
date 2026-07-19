import { setIcon } from "obsidian";
import type { ColumnDef, Role, TaskNode } from "../model/types.ts";
import { columnForRole, columnForStatus } from "../columns.ts";

export function roleLabel(role: Role): string {
	return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * The column a task belongs to: a leaf goes by its own status character; a parent
 * goes by its derived (rolled-up) role.
 */
export function placementColumn(node: TaskNode, columns: ColumnDef[]): ColumnDef | undefined {
	if (node.isLeaf) {
		return columnForStatus(node.statusChar, columns) ?? columnForRole(node.effectiveRole, columns);
	}
	return columnForRole(node.effectiveRole, columns);
}

export function createStatusChip(parent: HTMLElement, node: TaskNode, columns: ColumnDef[]): HTMLElement {
	const col = columnForRole(node.effectiveRole, columns);
	const chip = parent.createSpan({
		cls: "tt-chip",
		text: col ? col.name : roleLabel(node.effectiveRole),
	});
	chip.setAttribute("data-role", node.effectiveRole);
	if (col?.color) chip.style.setProperty("--tt-chip-color", col.color);
	return chip;
}

export function createProgressBadge(parent: HTMLElement, node: TaskNode): HTMLElement | null {
	if (node.progress.total <= 0) return null;
	const wrap = parent.createSpan({ cls: "tt-progress" });
	wrap.createSpan({
		cls: "tt-progress-text",
		text: `${node.progress.done}/${node.progress.total}`,
	});
	const bar = wrap.createDiv({ cls: "tt-progress-bar" });
	const fill = bar.createDiv({ cls: "tt-progress-fill" });
	const pct = Math.round((node.progress.done / node.progress.total) * 100);
	fill.style.width = pct + "%";
	return wrap;
}

export function createOverrideBadge(parent: HTMLElement, role: Role): HTMLElement {
	const b = parent.createSpan({
		cls: "tt-override-badge",
		attr: { "aria-label": `Manually set to ${roleLabel(role)}` },
	});
	setIcon(b, "lock");
	return b;
}

/** Build a small parent-chain breadcrumb (used in the flattened Kanban cards). */
export function breadcrumb(parent: HTMLElement, chain: string[]): void {
	if (chain.length === 0) return;
	parent.createSpan({ cls: "tt-breadcrumb", text: chain.join(" › ") });
}
