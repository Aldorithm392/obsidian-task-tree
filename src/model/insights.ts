// Dashboard insights: project health + the "what is blocking me" surfacing.
// Pure; runs under Node for tests.

import type { Role, TaskNode } from "./types.ts";
import { flatten } from "./parser.ts";

export interface Summary {
	total: number;
	done: number;
	byRole: Record<Role, number>;
}

/** Count every task node by its effective role. */
export function computeSummary(roots: TaskNode[]): Summary {
	const byRole: Record<Role, number> = { todo: 0, doing: 0, done: 0, cancelled: 0, blocked: 0 };
	let total = 0;
	for (const n of flatten(roots)) {
		if (!n.isTask) continue;
		total += 1;
		byRole[n.effectiveRole] += 1;
	}
	return { total, done: byRole.done, byRole };
}

export interface Insight {
	node: TaskNode;
	/** Ancestors, root-most first (excludes the node itself). */
	path: TaskNode[];
}

function walkWithPath(roots: TaskNode[], visit: (node: TaskNode, path: TaskNode[]) => void): void {
	const rec = (n: TaskNode, path: TaskNode[]): void => {
		visit(n, path);
		const next = [...path, n];
		for (const c of n.children) rec(c, next);
	};
	for (const r of roots) rec(r, []);
}

/** Blocked leaf tasks — the atomic blockers holding up their milestones. */
export function collectBlockers(roots: TaskNode[]): Insight[] {
	const out: Insight[] = [];
	walkWithPath(roots, (n, path) => {
		if (n.isTask && n.isLeaf && n.effectiveRole === "blocked") out.push({ node: n, path });
	});
	return out;
}

/** The actionable frontier: leaf tasks you can pick up now (in-progress first, then to-do). */
export function collectNextUp(roots: TaskNode[]): Insight[] {
	const doing: Insight[] = [];
	const todo: Insight[] = [];
	walkWithPath(roots, (n, path) => {
		if (!n.isTask || !n.isLeaf) return;
		if (n.effectiveRole === "doing") doing.push({ node: n, path });
		else if (n.effectiveRole === "todo") todo.push({ node: n, path });
	});
	return [...doing, ...todo];
}

/** Annotate each node with whether a blocked task sits anywhere below it. */
export function markBlockedPaths(roots: TaskNode[]): void {
	const visit = (n: TaskNode): void => {
		let below = false;
		for (const c of n.children) {
			visit(c);
			if (c.effectiveRole === "blocked" || c.hasBlockedDescendant) below = true;
		}
		n.hasBlockedDescendant = below;
	};
	for (const r of roots) visit(r);
}
