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

/**
 * Why one actionable leaf matters more than another — derived, never typed by a human.
 *
 * The plugin ships no priority field on purpose: every Obsidian implementation of one needs
 * an "unjudged" drawer, because rating work is a chore users skip. Both numbers here are
 * already computed for other reasons — the dependency graph and the roll-up — so they cost
 * nothing to keep true and can't go stale the way a hand-typed `!!high` does.
 */
export interface Leverage {
	/** Tasks that would become actionable the moment this one is finished. */
	unblocks: number;
	/** Ancestors that would roll up to done in cascade, nearest first. */
	completes: TaskNode[];
}

export interface NextUp extends Insight {
	leverage: Leverage;
}

function releases(r: Role): boolean {
	return r === "done" || r === "cancelled";
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

/**
 * The actionable frontier: leaf tasks you can pick up **now** (in-progress first, then to-do).
 *
 * "Now" is the whole contract, so three kinds of leaf are excluded even though their own
 * role says todo/doing — otherwise the panel recommends work the same panel calls stuck:
 *   • a leaf held by an unfinished `tt-blocked-by` dependency (it also appears under
 *     "Waiting on dependencies" — listing it in both places is advice contradicting itself);
 *   • a leaf under an ancestor the human explicitly overrode to `cancelled` (that branch
 *     was dropped on purpose) or to `done` (that milestone was closed with loose ends,
 *     deliberately and visibly).
 *
 * Only the OVERRIDE counts for the ancestor test, never a rolled-up role: roll-up lets
 * children win over a parent's own character, so a parent typed `[-]` with one unfinished
 * child legitimately reads `todo`. The override is the only place a human states intent
 * about a branch, which is exactly why the format puts it in visible ink.
 *
 * Ordering is two-tier and the outer tier is the opinionated one: **in-progress work stays
 * ahead of anything not started**, however much leverage the newcomer carries. You already
 * paid the cost of loading that context, and a list that nudges you to drop work in flight
 * to open a new front is the one failure a "next up" panel must not have. Leverage sorts
 * *within* each tier, so the high-value pickup is still near the top of its own group.
 */
export function collectNextUp(roots: TaskNode[], graph?: EdgeGraph): NextUp[] {
	const doing: NextUp[] = [];
	const todo: NextUp[] = [];
	walkWithPath(roots, (n, path) => {
		if (!n.isTask || !n.isLeaf) return;
		if (n.isDependencyBlocked) return;
		if (path.some((a) => a.override === "done" || a.override === "cancelled")) return;
		if (n.effectiveRole !== "doing" && n.effectiveRole !== "todo") return;
		const leverage: Leverage = {
			unblocks: graph ? unblockCount(n, graph) : 0,
			completes: milestonesClosedBy(path),
		};
		(n.effectiveRole === "doing" ? doing : todo).push({ node: n, path, leverage });
	});
	return [...byLeverage(doing), ...byLeverage(todo)];
}

/** Array.sort is stable, so equal leverage keeps document order — no tiebreak needed. */
function byLeverage(items: NextUp[]): NextUp[] {
	return items.sort(
		(a, b) =>
			b.leverage.unblocks - a.leverage.unblocks ||
			b.leverage.completes.length - a.leverage.completes.length,
	);
}

/**
 * How many waiting tasks finishing `node` would actually free.
 *
 * Deliberately strict: an edge counts only when `node` is the **last unreleased thing** its
 * waiter depends on. Reporting "3 are waiting on you" when two of them would stay stuck
 * behind something else turns the badge into a promise the board can't keep, and a number
 * that overstates is worse than no number. Waiters already done or cancelled don't count
 * either — freeing finished work frees nothing.
 */
export function unblockCount(node: TaskNode, graph: EdgeGraph): number {
	const freed = new Set<string>();
	for (const e of graph.edges) {
		if (e.to !== node || releases(e.from.effectiveRole)) continue;
		const heldElsewhere = graph.edges.some(
			(o) => o.from === e.from && o.to !== node && !releases(o.to.effectiveRole),
		);
		if (!heldElsewhere) freed.add(e.from.id);
	}
	return freed.size;
}

/**
 * The ancestors that would roll up to done in cascade if this leaf were finished, nearest
 * first. `path` is the leaf's ancestor chain as `walkWithPath` supplies it.
 *
 * `progress` already excludes cancelled children from its denominator, so "exactly one
 * unfinished child left" is just `total - done === 1` — and that one child is necessarily
 * the branch we walked up from.
 *
 * Two stops, both principled. An ancestor carrying an **override** is no longer decided by
 * its children, so finishing this leaf would not close it. A **non-task** bullet isn't
 * counted in its own parent's progress, so the cascade genuinely dies there.
 */
export function milestonesClosedBy(path: TaskNode[]): TaskNode[] {
	const out: TaskNode[] = [];
	for (let i = path.length - 1; i >= 0; i--) {
		const a = path[i]!;
		if (!a.isTask || a.override) break;
		if (a.progress.total - a.progress.done !== 1) break;
		out.push(a);
	}
	return out;
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
