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

// ---- dependency edges (tt-blocked-by) ----------------------------------------

export interface DependencyEdge {
	/** The task that is held up. */
	from: TaskNode;
	/** The task it waits on. */
	to: TaskNode;
}

export interface EdgeGraph {
	edges: DependencyEdge[];
	/** blockedBy ids that don't resolve to any task on the board, per referencing node id. */
	unresolved: Map<string, string[]>;
	/** Node ids that sit on at least one dependency cycle. */
	cycleIds: Set<string>;
}

/**
 * Resolve every `tt-blocked-by` reference into edges, and annotate each task with
 * `isDependencyBlocked` when something it waits on isn't finished yet.
 *
 * Deliberate: a dependency is a SEPARATE signal — it never feeds computeRollup, so a
 * parent's checkbox state stays recomputable from its own leaves. `done` and
 * `cancelled` dependencies release their edge; everything else holds it.
 */
export function resolveEdges(roots: TaskNode[]): EdgeGraph {
	const nodes = flatten(roots).filter((n) => n.isTask);
	const byId = new Map(nodes.map((n) => [n.id, n]));

	const edges: DependencyEdge[] = [];
	const unresolved = new Map<string, string[]>();
	for (const n of nodes) {
		for (const dep of n.blockedBy) {
			const to = byId.get(dep);
			if (!to || to === n) {
				const list = unresolved.get(n.id) ?? [];
				list.push(dep);
				unresolved.set(n.id, list);
				continue;
			}
			edges.push({ from: n, to });
		}
	}

	// Iterative three-color DFS over the dependency graph only (never the tree).
	const out = new Map<string, TaskNode[]>();
	for (const e of edges) {
		const list = out.get(e.from.id) ?? [];
		list.push(e.to);
		out.set(e.from.id, list);
	}
	const color = new Map<string, 0 | 1 | 2>(); // 0/absent = white, 1 = on stack, 2 = done
	const cycleIds = new Set<string>();
	for (const start of out.keys()) {
		if (color.get(start)) continue;
		const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
		color.set(start, 1);
		while (stack.length > 0) {
			const top = stack[stack.length - 1]!;
			const targets = out.get(top.id) ?? [];
			if (top.next < targets.length) {
				const t = targets[top.next++]!;
				const c = color.get(t.id);
				if (c === 1) {
					// Back edge: everything from t's stack frame up is on the cycle.
					const at = stack.findIndex((f) => f.id === t.id);
					for (let i = Math.max(0, at); i < stack.length; i++) cycleIds.add(stack[i]!.id);
				} else if (!c) {
					color.set(t.id, 1);
					stack.push({ id: t.id, next: 0 });
				}
			} else {
				color.set(top.id, 2);
				stack.pop();
			}
		}
	}

	const releases = (r: Role): boolean => r === "done" || r === "cancelled";
	for (const n of nodes) n.isDependencyBlocked = false;
	for (const e of edges) {
		if (!releases(e.to.effectiveRole)) e.from.isDependencyBlocked = true;
	}

	return { edges, unresolved, cycleIds };
}

/**
 * Tasks whose linked notes still hold unfinished checklist work — the depth the board
 * alone can't show. Ordered deepest-backlog first, so the biggest hidden pile leads.
 * A separate signal, like dependencies: it never touches roll-up.
 */
export function collectNoteWork(roots: TaskNode[]): Insight[] {
	const out: Insight[] = [];
	walkWithPath(roots, (n, path) => {
		const p = n.noteProgress;
		if (n.isTask && p && p.total > p.done) out.push({ node: n, path });
	});
	return out.sort((a, b) => pending(b.node) - pending(a.node));
}

function pending(n: TaskNode): number {
	const p = n.noteProgress;
	return p ? p.total - p.done : 0;
}

/** Dependency-held tasks, for the Blockers panel: waiting on unfinished work elsewhere. */
export function collectDependencyBlocked(roots: TaskNode[]): Insight[] {
	const out: Insight[] = [];
	walkWithPath(roots, (n, path) => {
		if (n.isTask && n.isDependencyBlocked) out.push({ node: n, path });
	});
	return out;
}
