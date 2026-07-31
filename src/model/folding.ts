// What a board shows when you open it.
//
// Roll-up computes, for every parent, the one number that answers "how is that going".
// A view that then opens every branch has spent that signal before the user sees it: a
// 40-task project arrives as 40 rows and the fraction on the parent is decoration. So the
// board opens shallow, and a folded parent's `2/5` is permission not to look.
//
// Pure so the off-by-one is a test rather than a thing someone notices in a screenshot.

import type { TaskNode } from "./types.ts";

export interface FoldState {
	/** How many levels of rows are visible by default. 2 = roots and their children. */
	openDepth: number;
	/** Folded by hand — beats the depth default. */
	collapsed: ReadonlySet<string>;
	/** Unfolded by hand — beats the depth default. */
	expanded: ReadonlySet<string>;
	/**
	 * Depth of the rows being treated as roots. 0 for a whole board; the focused node's own
	 * depth when the view is scoped to a branch.
	 *
	 * Without it, focusing a branch and opening shallow contradict each other: a node at
	 * depth 3 becomes the only row you asked to see AND three levels past the default, so
	 * "show me this subtree" would render one row with everything under it hidden. Depth is
	 * only ever meaningful relative to what you are looking at.
	 */
	baseDepth?: number;
}

/**
 * Is this node's branch hidden?
 *
 * Tri-state on purpose. Once a depth default exists, "absent from the collapsed set" can
 * no longer mean "open" — an unfolded branch would silently re-fold the next time the
 * default was applied. An explicit choice, in either direction, outranks depth forever.
 */
export function isFolded(node: TaskNode, state: FoldState): boolean {
	if (state.collapsed.has(node.id)) return true;
	if (state.expanded.has(node.id)) return false;
	// A node at depth d hides children at depth d+1, so it folds once d+1 reaches the
	// opening depth: at openDepth 2 you see roots and their children, and nothing deeper.
	return node.depth - (state.baseDepth ?? 0) + 1 >= state.openDepth;
}

/** Rows a board renders with this fold state, in document order. */
export function visibleNodes(roots: TaskNode[], state: FoldState): TaskNode[] {
	const out: TaskNode[] = [];
	const walk = (n: TaskNode): void => {
		out.push(n);
		if (n.children.length === 0 || isFolded(n, state)) return;
		for (const c of n.children) walk(c);
	};
	for (const r of roots) walk(r);
	return out;
}
