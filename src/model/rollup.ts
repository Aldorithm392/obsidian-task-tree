import type { RollupOptions, TaskNode } from "./types.ts";

/**
 * Annotate every node with its derived, effective role and progress, computed
 * post-order (children first). This is the deterministic roll-up: any agent that
 * reads the leaves can recompute the same parent state.
 *
 *   - A node with an explicit override reports the override.
 *   - A leaf (no task children) reports its own literal role.
 *   - A parent reports:
 *       done      iff every non-cancelled task child is done
 *       cancelled iff it has task children and all of them are cancelled
 *       blocked   iff any child is blocked (when blockedDominates)
 *       doing     iff any child has started (doing/done/blocked)
 *       todo      otherwise
 *
 * Progress is the fraction of non-cancelled *direct* task children that are done.
 */
export function computeRollup(roots: TaskNode[], opts: RollupOptions): void {
	for (const r of roots) visit(r, opts);
}

function visit(node: TaskNode, opts: RollupOptions): void {
	for (const child of node.children) visit(child, opts);

	const taskChildren = node.children.filter((c) => c.isTask);

	if (taskChildren.length === 0) {
		node.derivedRole = node.literalRole;
		node.progress = { done: 0, total: 0 };
	} else {
		const active = taskChildren.filter((c) => c.effectiveRole !== "cancelled");
		const done = active.filter((c) => c.effectiveRole === "done").length;
		node.progress = { done, total: active.length };

		if (active.length === 0) {
			node.derivedRole = "cancelled";
		} else if (active.every((c) => c.effectiveRole === "done")) {
			node.derivedRole = "done";
		} else if (opts.blockedDominates && active.some((c) => c.effectiveRole === "blocked")) {
			node.derivedRole = "blocked";
		} else if (
			active.some(
				(c) =>
					c.effectiveRole === "doing" ||
					c.effectiveRole === "done" ||
					c.effectiveRole === "blocked",
			)
		) {
			node.derivedRole = "doing";
		} else {
			node.derivedRole = "todo";
		}
	}

	node.effectiveRole =
		node.override ?? (taskChildren.length > 0 ? node.derivedRole : node.literalRole);
}
