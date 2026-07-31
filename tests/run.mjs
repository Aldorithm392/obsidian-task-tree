// Pure-logic tests for Task Tree. Runs under Node's native TypeScript type
// stripping (Node >= 23.6) with zero dependencies:  `node tests/run.mjs`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLine } from "../src/model/line.ts";
import { buildTree, flatten as flattenAll } from "../src/model/parser.ts";
import { isFolded, visibleNodes } from "../src/model/folding.ts";
import { computeRollup, isDerived } from "../src/model/rollup.ts";
import {
	setStatusInText,
	setOverrideInText,
	clearOverrideInText,
	assignIdsInText,
	moveSubtreeInText,
	frontmatterEndLine,
	insertTaskInText,
	deleteRangeInText,
	setTaskTextInText,
	addTagInText,
	setBlockedByInText,
	clearBlockedByInText,
} from "../src/model/writer.ts";
import {
	DEFAULT_COLUMNS,
	validateColumns,
	roleForStatus,
	canonicalStatusForRole,
	deviatesFromPublished,
	resolveStatus,
	boardLanes,
} from "../src/columns.ts";
import { ALL_ROLES } from "../src/model/types.ts";
import { columnsFromFrontmatter } from "../src/model/okf.ts";
import { expectedNoteFields, noteFieldsDrift, retiredFieldsPresent } from "../src/model/notemeta.ts";
import { generateId } from "../src/model/ids.ts";
import {
	computeSummary,
	collectBlockers,
	collectDependencyBlocked,
	collectNextUp,
	collectNoteWork,
	markBlockedPaths,
	resolveEdges,
} from "../src/model/insights.ts";
import { pendingNoteWork, walkNoteProgress } from "../src/model/noteprogress.ts";
import { displayForm, foldDiacritics } from "../src/model/fuzzy.ts";
import {
	parseNoteSections,
	parseStarterTasks,
	renderNoteSections,
	renderStarterTasks,
} from "../src/model/templates.ts";

// ---- tiny test runner --------------------------------------------------------
let passed = 0;
let failed = 0;
function test(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  ✓ ${name}`);
	} catch (err) {
		failed += 1;
		console.error(`  ✗ ${name}`);
		console.error(`      ${err && err.message ? err.message : err}`);
	}
}

// Full-role column set for the tests that exercise cancelled / blocked.
const COLS = [
	{ id: "todo", name: "To Do", status: " ", role: "todo" },
	{ id: "doing", name: "Doing", status: "/", role: "doing" },
	{ id: "blocked", name: "Blocked", status: "!", role: "blocked" },
	{ id: "done", name: "Done", status: "x", role: "done" },
	{ id: "cancelled", name: "Cancelled", status: "-", role: "cancelled" },
];
const ROLLUP_OPTS = { unknownRole: "doing", blockedDominates: true };

// Mimic Obsidian's listItems: parent = parent line when nested, else -(firstListLine).
function itemsFromLines(lines) {
	const items = [];
	const stack = [];
	let firstListLine = -1;
	for (let i = 0; i < lines.length; i++) {
		const p = parseLine(lines[i]);
		if (p.marker === "") continue;
		if (firstListLine < 0) firstListLine = i;
		const indentLen = p.indentText.length;
		while (stack.length && stack[stack.length - 1].indentLen >= indentLen) stack.pop();
		const parent = stack.length ? stack[stack.length - 1].line : -firstListLine;
		items.push({
			line: i,
			endLine: i,
			task: p.isTask ? p.statusChar : undefined,
			blockId: p.blockId,
			parent,
		});
		stack.push({ indentLen, line: i });
	}
	return items;
}

function parse(lines, cols = COLS) {
	const roots = buildTree(itemsFromLines(lines), lines, { columns: cols, unknownRole: "doing" });
	computeRollup(roots, ROLLUP_OPTS);
	return roots;
}

// ---- parseLine ---------------------------------------------------------------
console.log("parseLine");
test("basic task with block id", () => {
	const p = parseLine("- [ ] Hello world ^t-1");
	assert.equal(p.isTask, true);
	assert.equal(p.statusChar, " ");
	assert.equal(p.text, "Hello world");
	assert.equal(p.blockId, "t-1");
	assert.equal(p.marker, "-");
});
test("indented task with override field", () => {
	const p = parseLine("\t- [x] Ship it [tt-override:: done] ^t-2");
	assert.equal(p.indentText, "\t");
	assert.equal(p.statusChar, "x");
	assert.equal(p.override, "done");
	assert.equal(p.text, "Ship it");
	assert.equal(p.blockId, "t-2");
});
test("plain bullet is not a task", () => {
	const p = parseLine("- just a note");
	assert.equal(p.isTask, false);
	assert.equal(p.text, "just a note");
});
test("non-list line", () => {
	const p = parseLine("# Heading");
	assert.equal(p.marker, "");
	assert.equal(p.isTask, false);
});

// ---- buildTree + rollup ------------------------------------------------------
console.log("buildTree + rollup");
test("nested tree structure, depth and extent", () => {
	const lines = [
		"- [ ] A ^t-a",
		"\t- [x] A1 ^t-a1",
		"\t- [ ] A2 ^t-a2",
		"\t\t- [x] A2a ^t-a2a",
		"- [x] B ^t-b",
	];
	const roots = parse(lines);
	assert.equal(roots.length, 2);
	const [a, b] = roots;
	assert.equal(a.text, "A");
	assert.equal(a.children.length, 2);
	assert.equal(a.children[1].children.length, 1);
	assert.equal(a.depth, 0);
	assert.equal(a.children[1].depth, 1);
	assert.equal(a.children[1].children[0].depth, 2);
	assert.equal(a.lastDescLine, 3); // A2a
	assert.equal(b.lastDescLine, 4);
});
test("parent doing with partial progress", () => {
	const roots = parse(["- [ ] A", "\t- [x] A1", "\t- [ ] A2"]);
	assert.equal(roots[0].effectiveRole, "doing");
	assert.deepEqual(roots[0].progress, { done: 1, total: 2 });
});
test("parent done when all children done", () => {
	const roots = parse(["- [ ] A", "\t- [x] A1", "\t- [x] A2"]);
	assert.equal(roots[0].effectiveRole, "done");
	assert.deepEqual(roots[0].progress, { done: 2, total: 2 });
});
test("all children cancelled => parent cancelled", () => {
	const roots = parse(["- [ ] A", "\t- [-] A1", "\t- [-] A2"]);
	assert.equal(roots[0].effectiveRole, "cancelled");
	assert.deepEqual(roots[0].progress, { done: 0, total: 0 });
});
test("cancelled child excluded from denominator", () => {
	const roots = parse(["- [ ] A", "\t- [x] A1", "\t- [-] A2"]);
	assert.equal(roots[0].effectiveRole, "done");
	assert.deepEqual(roots[0].progress, { done: 1, total: 1 });
});
test("blocked child surfaces to parent", () => {
	const roots = parse(["- [ ] A", "\t- [x] A1", "\t- [!] A2"]);
	assert.equal(roots[0].effectiveRole, "blocked");
});
test("manual override wins over derived", () => {
	const roots = parse(["- [x] A [tt-override:: done] ^t-a", "\t- [ ] A1"]);
	assert.equal(roots[0].override, "done");
	assert.equal(roots[0].derivedRole, "todo");
	assert.equal(roots[0].effectiveRole, "done");
	assert.deepEqual(roots[0].progress, { done: 0, total: 1 });
});
test("leaf reports its own literal role", () => {
	const roots = parse(["- [/] Solo"]);
	assert.equal(roots[0].isLeaf, true);
	assert.equal(roots[0].effectiveRole, "doing");
});
test("unknown status char falls back to unknownRole (doing)", () => {
	const roots = parse(["- [?] Mystery"], DEFAULT_COLUMNS);
	assert.equal(roots[0].effectiveRole, "doing");
});

// ---- writer: setStatus -------------------------------------------------------
console.log("writer.setStatus");
test("flip status preserves indentation and id", () => {
	const text = "- [ ] A ^t-a\n\t- [x] A1 ^t-a1";
	const out = setStatusInText(text, 0, "/");
	assert.equal(out.split("\n")[0], "- [/] A ^t-a");
	assert.equal(out.split("\n")[1], "\t- [x] A1 ^t-a1");
});
test("flip status on an indented line", () => {
	const out = setStatusInText("- [ ] A\n\t- [ ] A1 ^x", 1, "x");
	assert.equal(out.split("\n")[1], "\t- [x] A1 ^x");
});
test("setStatus leaves non-task lines alone", () => {
	assert.equal(setStatusInText("plain text", 0, "x"), "plain text");
});

// ---- writer: override --------------------------------------------------------
console.log("writer.override");
test("set override writes field and canonical char", () => {
	assert.equal(
		setOverrideInText("- [ ] A ^t-a", 0, "done", COLS),
		"- [x] A [tt-override:: done] ^t-a",
	);
});
test("clear override removes field, keeps status", () => {
	assert.equal(
		clearOverrideInText("- [x] A [tt-override:: done] ^t-a", 0),
		"- [x] A ^t-a",
	);
});

// ---- writer: assignIds -------------------------------------------------------
console.log("writer.assignIds");
test("assigns ids to task lines, skips frontmatter and existing ids", () => {
	const text = [
		"---",
		"type: task-tree",
		"tt_columns:",
		'  - { name: To Do, status: " ", role: todo }',
		"---",
		"- [ ] A",
		"- [x] B ^t-b",
		"\t- [ ] B1",
	].join("\n");
	assert.equal(frontmatterEndLine(text.split("\n")), 5);
	const { text: out, assigned } = assignIdsInText(text, { prefix: "t-", length: 6 });
	const lines = out.split("\n");
	assert.equal(assigned, 2);
	assert.match(lines[5], /^- \[ \] A \^t-[0-9a-z]{6}$/);
	assert.equal(lines[6], "- [x] B ^t-b");
	assert.match(lines[7], /^\t- \[ \] B1 \^t-[0-9a-z]{6}$/);
	assert.equal(lines[3], '  - { name: To Do, status: " ", role: todo }'); // frontmatter untouched
});

// ---- writer: moveSubtree -----------------------------------------------------
console.log("writer.moveSubtree");
test("move a leaf between roots (tabs, no depth change)", () => {
	const text = ["- [ ] A", "\t- [ ] A1", "\t- [ ] A2", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 2,
		end: 2,
		insertAfter: 3,
		oldDepth: 1,
		newDepth: 1,
		indentUnit: "\t",
	});
	assert.equal(out, ["- [ ] A", "\t- [ ] A1", "- [ ] B", "\t- [ ] A2"].join("\n"));
});
test("move a subtree and re-indent it shallower (tabs)", () => {
	const text = ["- [ ] A", "\t- [ ] A1", "\t\t- [ ] A1a", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 2,
		insertAfter: 3,
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "\t",
	});
	assert.equal(out, ["- [ ] A", "- [ ] B", "- [ ] A1", "\t- [ ] A1a"].join("\n"));
});
test("re-indent deeper preserves relative structure (4 spaces)", () => {
	const text = ["- [ ] A", "    - [ ] A1", "        - [ ] A1a", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 2,
		insertAfter: 3,
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "    ",
	});
	assert.equal(out, ["- [ ] A", "- [ ] B", "- [ ] A1", "    - [ ] A1a"].join("\n"));
});
test("lift a 4-space child to root with the file's own unit lands at column 0", () => {
	// Regression: moves must re-indent with the FILE's indent unit, not the settings'.
	const text = ["- [ ] A", "    - [ ] child ^t-abc123", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 1,
		insertAfter: 2,
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "    ", // the file's real unit — what loadBoard now detects
	});
	assert.equal(out, ["- [ ] A", "- [ ] B", "- [ ] child ^t-abc123"].join("\n"));
});
test("absolute rebase lifts to column 0 even with a mismatched unit", () => {
	// Because we rebase to newDepth (not strip a delta), the wrong unit can't leave residue.
	const text = ["- [ ] A", "    - [ ] child", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 1,
		insertAfter: 2,
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "\t", // "wrong" unit for a space file — rebase still lands at column 0
	});
	assert.equal(out.split("\n")[2], "- [ ] child");
});
test("mixed tab/space file: lifting a deep space branch to root lands at column 0, keeps relative shape", () => {
	// A: tab-indented branch; B: space-indented branch. Move B1a (8 spaces, depth 2) to root.
	const text = ["- [ ] A", "\t- [ ] A1", "- [ ] B", "    - [ ] B1", "        - [ ] B1a"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 4,
		end: 4,
		insertAfter: 4, // reinsert in place, shallower
		oldDepth: 2,
		newDepth: 0,
		indentUnit: "\t", // detected from A1 — the WRONG style for the B branch
	});
	assert.equal(out.split("\n")[4], "- [ ] B1a");
});
test("mixed-indent continuation line shifts by delta (not reset) when its subtree moves", () => {
	// X is tab-indented; a space-indented continuation note sits under it (different style).
	const text = ["- [ ] A", "\t- [ ] X", "    spaces note", "- [ ] C"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 2, // X + its continuation note
		insertAfter: 0, // nest under A
		oldDepth: 1,
		newDepth: 2,
		indentUnit: "\t",
	});
	const lines = out.split("\n");
	assert.equal(lines[1], "\t\t- [ ] X"); // task line: 1 tab -> 2 tabs
	assert.equal(lines[2], "\t    spaces note"); // note: shifted by +1, keeps its 4 spaces (not over-indented)
});
test("re-indent with 2-space unit", () => {
	const text = ["- [ ] A", "  - [ ] A1", "- [ ] B"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 1,
		insertAfter: 2,
		oldDepth: 1,
		newDepth: 1,
		indentUnit: "  ",
	});
	assert.equal(out, ["- [ ] A", "- [ ] B", "  - [ ] A1"].join("\n"));
});
test("refuses to drop a subtree strictly inside itself", () => {
	const text = ["- [ ] A", "\t- [ ] A1", "\t- [ ] A2"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 0,
		end: 2,
		insertAfter: 1, // strictly between start and end
		oldDepth: 0,
		newDepth: 0,
		indentUnit: "\t",
	});
	assert.equal(out, text);
});
test("outdent the last child (insertAfter === end) reinserts in place, shallower", () => {
	const text = ["- [ ] A", "\t- [ ] B", "\t- [ ] C"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 2,
		end: 2,
		insertAfter: 2, // == end: parent's lastDescLine when C is the tail
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "\t",
	});
	assert.equal(out, ["- [ ] A", "\t- [ ] B", "- [ ] C"].join("\n"));
});
test("re-indent preserves non-task continuation lines", () => {
	const text = ["- [ ] A", "\t- [ ] B", "\t\tnote under B", "- [ ] C"].join("\n");
	const out = moveSubtreeInText(text, {
		start: 1,
		end: 2,
		insertAfter: 3,
		oldDepth: 1,
		newDepth: 0,
		indentUnit: "\t",
	});
	assert.equal(out, ["- [ ] A", "- [ ] C", "- [ ] B", "\tnote under B"].join("\n"));
});

// ---- ids ---------------------------------------------------------------------
console.log("ids");
test("generateId produces unique prefixed ids", () => {
	const existing = new Set();
	const seen = new Set();
	for (let i = 0; i < 1000; i++) {
		const id = generateId(existing, "t-", 6);
		assert.ok(id.startsWith("t-"));
		assert.ok(!seen.has(id));
		seen.add(id);
	}
});

// ---- columns -----------------------------------------------------------------
console.log("columns");
test("default columns validate cleanly", () => {
	assert.deepEqual(validateColumns(DEFAULT_COLUMNS), []);
});
test("duplicate status character is rejected", () => {
	const bad = [
		{ id: "a", name: "A", status: " ", role: "todo" },
		{ id: "b", name: "B", status: " ", role: "done" },
	];
	assert.ok(validateColumns(bad).some((e) => e.includes("status character")));
});
test("non-positive WIP limit is rejected; positive passes", () => {
	const cols = [
		{ id: "todo", name: "To Do", status: " ", role: "todo" },
		{ id: "done", name: "Done", status: "x", role: "done", wipLimit: 0 },
	];
	assert.ok(validateColumns(cols).some((e) => e.includes("WIP limit")));
	cols[1].wipLimit = 3;
	assert.deepEqual(validateColumns(cols), []);
});
test("tt_columns round-trips color and wipLimit", () => {
	const fm = {
		tt_columns: [
			{ name: "To Do", status: " ", role: "todo", color: "#8888ff", wipLimit: 4 },
			{ name: "Done", status: "x", role: "done", wipLimit: 0 }, // invalid limit → dropped
		],
	};
	const cols = columnsFromFrontmatter(fm, DEFAULT_COLUMNS);
	assert.equal(cols[0].color, "#8888ff");
	assert.equal(cols[0].wipLimit, 4);
	assert.equal(cols[1].color, undefined);
	assert.equal(cols[1].wipLimit, undefined);
});

// ---- writer: CRUD ------------------------------------------------------------
console.log("writer.crud");
test("insert child task after the parent's subtree", () => {
	const text = ["- [ ] A", "\t- [ ] A1", "- [ ] B"].join("\n");
	const out = insertTaskInText(text, 1, "\t", "A2");
	assert.equal(out, ["- [ ] A", "\t- [ ] A1", "\t- [ ] A2", "- [ ] B"].join("\n"));
});
test("delete a subtree range", () => {
	const text = ["- [ ] A", "\t- [ ] A1", "\t\t- [ ] A1a", "- [ ] B"].join("\n");
	assert.equal(deleteRangeInText(text, 1, 2), ["- [ ] A", "- [ ] B"].join("\n"));
});
test("rename preserves status, override and id", () => {
	assert.equal(
		setTaskTextInText("\t- [x] Old [tt-override:: done] ^t-1", 0, "New"),
		"\t- [x] New [tt-override:: done] ^t-1",
	);
});
test("add tag before the block id", () => {
	assert.equal(addTagInText("- [ ] A ^t-1", 0, "urgent"), "- [ ] A #urgent ^t-1");
});
test("add tag is idempotent", () => {
	const once = addTagInText("- [ ] A", 0, "x");
	assert.equal(addTagInText(once, 0, "x"), once);
});

// ---- insights ----------------------------------------------------------------
console.log("insights");
test("summary counts every task by role", () => {
	const s = computeSummary(parse(["- [ ] A", "\t- [x] A1", "\t- [!] A2", "- [x] B"]));
	assert.equal(s.total, 4);
	assert.equal(s.byRole.done, 2);
	assert.equal(s.byRole.blocked, 2); // A derives blocked, A2 is blocked
});
test("blockers are blocked leaves with their path", () => {
	const b = collectBlockers(parse(["- [ ] A", "\t- [!] A2"]));
	assert.equal(b.length, 1);
	assert.equal(b[0].node.text, "A2");
	assert.equal(b[0].path.map((n) => n.text).join("/"), "A");
});
test("markBlockedPaths flags every ancestor of a blocked leaf", () => {
	const roots = parse(["- [ ] A", "\t- [ ] A1", "\t\t- [!] A1a"]);
	markBlockedPaths(roots);
	const a = roots[0];
	const a1 = a.children[0];
	assert.equal(a.hasBlockedDescendant, true);
	assert.equal(a1.hasBlockedDescendant, true);
	assert.equal(a1.children[0].hasBlockedDescendant, false);
});
test("next up lists actionable leaves, in-progress first", () => {
	const nu = collectNextUp(parse(["- [ ] A", "\t- [/] A1", "\t- [ ] A2", "\t- [x] A3", "\t- [!] A4"]));
	assert.deepEqual(
		nu.map((i) => i.node.text),
		["A1", "A2"],
	);
});

// ---- dependencies (tt-blocked-by) --------------------------------------------
console.log("dependencies");
test("parseLine extracts and strips tt-blocked-by", () => {
	const p = parseLine("- [ ] Deploy [tt-blocked-by:: t-a1, t-b2] ^t-c3");
	assert.equal(p.text, "Deploy");
	assert.deepEqual(p.blockedBy, ["t-a1", "t-b2"]);
	assert.equal(p.blockId, "t-c3");
});
test("blocked-by coexists with an override, any order", () => {
	const p = parseLine("- [x] Ship [tt-blocked-by:: t-a1] [tt-override:: done] ^t-z9");
	assert.equal(p.text, "Ship");
	assert.equal(p.override, "done");
	assert.deepEqual(p.blockedBy, ["t-a1"]);
});
test("malformed ids inside the field are dropped; empty field parses as none", () => {
	assert.deepEqual(parseLine("- [ ] X [tt-blocked-by:: t-a1, not a id!, t-b2]").blockedBy, ["t-a1", "t-b2"]);
	assert.equal(parseLine("- [ ] X [tt-blocked-by:: ]").blockedBy, undefined);
	assert.equal(parseLine("- [ ] X [tt-blocked-by:: ]").text, "X");
});
test("setBlockedByInText writes the field before the block id", () => {
	const out = setBlockedByInText("- [ ] Deploy ^t-c3", 0, ["t-a1", "t-b2"]);
	assert.equal(out, "- [ ] Deploy [tt-blocked-by:: t-a1, t-b2] ^t-c3");
});
test("setBlockedByInText replaces an existing field; empty list clears it", () => {
	const line = "- [ ] Deploy [tt-blocked-by:: t-old] ^t-c3";
	assert.equal(setBlockedByInText(line, 0, ["t-new"]), "- [ ] Deploy [tt-blocked-by:: t-new] ^t-c3");
	assert.equal(setBlockedByInText(line, 0, []), "- [ ] Deploy ^t-c3");
	assert.equal(clearBlockedByInText(line, 0), "- [ ] Deploy ^t-c3");
});
test("rename and tag preserve the blocked-by field", () => {
	const line = "- [/] Old text [tt-blocked-by:: t-a1] ^t-c3";
	assert.equal(setTaskTextInText(line, 0, "New text"), "- [/] New text [tt-blocked-by:: t-a1] ^t-c3");
	assert.equal(addTagInText(line, 0, "urgent"), "- [/] Old text #urgent [tt-blocked-by:: t-a1] ^t-c3");
});
test("assignIds appends the id after the blocked-by field", () => {
	const res = assignIdsInText("- [ ] X [tt-blocked-by:: t-a1]", { prefix: "t-", length: 6 });
	assert.equal(res.assigned, 1);
	assert.match(res.text, /^- \[ \] X \[tt-blocked-by:: t-a1\] \^t-[a-z0-9]{6}$/);
});
test("resolveEdges: unfinished dependency holds, done/cancelled release", () => {
	const roots = parse([
		"- [ ] API ^t-api",
		"- [x] Schema ^t-sch",
		"- [ ] Deploy [tt-blocked-by:: t-api, t-sch] ^t-dep",
	]);
	const g = resolveEdges(roots);
	assert.equal(g.edges.length, 2);
	const dep = roots[2];
	assert.equal(dep.isDependencyBlocked, true); // t-api is not done
	assert.equal(roots[0].isDependencyBlocked, false);
	// finish the API task → everything released
	const roots2 = parse([
		"- [x] API ^t-api",
		"- [x] Schema ^t-sch",
		"- [ ] Deploy [tt-blocked-by:: t-api, t-sch] ^t-dep",
	]);
	resolveEdges(roots2);
	assert.equal(roots2[2].isDependencyBlocked, false);
});
test("resolveEdges records unresolved ids and self-references", () => {
	const roots = parse(["- [ ] A [tt-blocked-by:: t-ghost, t-a] ^t-a"]);
	const g = resolveEdges(roots);
	assert.equal(g.edges.length, 0);
	assert.deepEqual(g.unresolved.get("t-a"), ["t-ghost", "t-a"]);
});
test("resolveEdges detects a dependency cycle", () => {
	const roots = parse([
		"- [ ] A [tt-blocked-by:: t-b] ^t-a",
		"- [ ] B [tt-blocked-by:: t-a] ^t-b",
		"- [ ] C [tt-blocked-by:: t-a] ^t-c",
	]);
	const g = resolveEdges(roots);
	assert.ok(g.cycleIds.has("t-a"));
	assert.ok(g.cycleIds.has("t-b"));
	assert.ok(!g.cycleIds.has("t-c"));
});
test("collectDependencyBlocked surfaces held tasks with their path", () => {
	const roots = parse([
		"- [ ] Milestone",
		"\t- [ ] Blocked one [tt-blocked-by:: t-x] ^t-y",
		"- [/] X ^t-x",
	]);
	resolveEdges(roots);
	const held = collectDependencyBlocked(roots);
	assert.equal(held.length, 1);
	assert.equal(held[0].node.text, "Blocked one");
	assert.equal(held[0].path.map((n) => n.text).join("/"), "Milestone");
});
test("dependencies never leak into roll-up", () => {
	const roots = parse([
		"- [ ] Parent",
		"\t- [x] Child done [tt-blocked-by:: t-q] ^t-p",
		"- [ ] Q ^t-q",
	]);
	resolveEdges(roots);
	// Child is checkbox-done; its unresolved dependency does NOT drag the parent.
	assert.equal(roots[0].effectiveRole, "done");
});

// ---- contract conformance ----------------------------------------------------
// docs/agent/CONTRACT.md publishes the grammar for agents. These tests parse the
// document's own examples with the real parser — docs that lie to an agent are
// worse than no docs, so drift fails the suite.
console.log("contract conformance");
const contractDoc = readFileSync(new URL("../docs/agent/CONTRACT.md", import.meta.url), "utf8");
test("CONTRACT.md states the canonical task-line grammar", () => {
	assert.ok(
		contractDoc.includes(
			"<indent><marker> [<status>] <text> [tt-override:: <role>]? [tt-blocked-by:: <id>, <id>…]? ^<id>?",
		),
	);
});
test("every conformance example in CONTRACT.md parses as annotated", () => {
	const section = contractDoc.split("## Conformance examples")[1] ?? "";
	const examples = [...section.matchAll(/```markdown\n([^\n]+)\n```/g)].map((m) => m[1]);
	assert.equal(examples.length, 4, "expected 4 conformance examples in CONTRACT.md");
	const expected = {
		"t-1": { status: " ", text: "Hello world" },
		"t-2": { status: "x", text: "Ship it", override: "done", indent: "\t" },
		"t-3": { status: " ", text: "Announce", blockedBy: ["t-qa", "t-copy"] },
		"t-4": { status: "/", text: "Both", override: "blocked", blockedBy: ["t-a"] },
	};
	const seen = new Set();
	for (const line of examples) {
		const p = parseLine(line);
		const exp = expected[p.blockId];
		assert.ok(exp, `no expectation for the example with id "${p.blockId}"`);
		seen.add(p.blockId);
		assert.equal(p.isTask, true);
		assert.equal(p.statusChar, exp.status);
		assert.equal(p.text, exp.text);
		assert.equal(p.override, exp.override);
		if (exp.blockedBy) assert.deepEqual(p.blockedBy, exp.blockedBy);
		else assert.equal(p.blockedBy, undefined);
		if (exp.indent) assert.equal(p.indentText, exp.indent);
	}
	assert.equal(seen.size, 4);
});
test("the skill's bundled contract is byte-identical to docs/agent/CONTRACT.md", () => {
	const bundled = readFileSync(new URL("../skills/task-tree/reference/contract.md", import.meta.url), "utf8");
	assert.equal(bundled, contractDoc);
});

// ---- note frontmatter: what a note may and may not carry --------------------
console.log("note frontmatter");
test("expectedNoteFields carries only what a note cannot derive from itself", () => {
	const f = expectedNoteFields({ title: "Hotel", parentTitle: "Alojamiento", boardName: "B" });
	assert.deepEqual(f, { title: "Hotel", parent: "Alojamiento" });
});
test("a root task maps to parent '(root)'", () => {
	assert.equal(expectedNoteFields({ title: "Solo", parentTitle: null, boardName: "B" }).parent, "(root)");
});
test("noteFieldsDrift pinpoints exactly the stale keys", () => {
	const expected = expectedNoteFields({ title: "Hotel", parentTitle: "Alojamiento renombrado", boardName: "B" });
	const cached = { title: "Hotel", parent: "Alojamiento", task_id: "t-x" }; // parent is stale
	assert.deepEqual(noteFieldsDrift(cached, expected), ["parent"]);
});
test("noteFieldsDrift: missing frontmatter drifts everything; in-sync drifts nothing", () => {
	const expected = expectedNoteFields({ title: "T", parentTitle: null, boardName: "B" });
	assert.equal(noteFieldsDrift(undefined, expected).length, 2);
	assert.deepEqual(noteFieldsDrift({ title: "T", parent: "(root)" }, expected), []);
});
test("the retired derivations are detected so reconcile can remove them", () => {
	// Stopping the writes is not enough — keys already on disk would rot with nothing
	// marking them stale, which is worse than maintaining them.
	assert.deepEqual(
		retiredFieldsPresent({ title: "T", parent: "(root)", depth: 2, distance_to_main: 2, path: "A / B / T" }),
		["depth", "distance_to_main", "path"],
	);
	assert.deepEqual(retiredFieldsPresent({ title: "T", parent: "(root)" }), []);
	assert.deepEqual(retiredFieldsPresent(undefined), []);
});
test("a note the plugin writes today carries none of the retired keys", () => {
	const f = expectedNoteFields({ title: "T", parentTitle: null, boardName: "B" });
	assert.deepEqual(retiredFieldsPresent(f), []);
});

// ---- recursive note progress (v1.1) -----------------------------------------
console.log("note progress (linked notes)");

/** Build a `read` from a plain {path: {roles, links}} map, counting the reads. */
function noteReader(web) {
	const reads = [];
	const read = (path) => {
		reads.push(path);
		return web[path] ?? null;
	};
	read.reads = reads;
	return read;
}

test("a task's own note contributes its checklist, cancelled items excluded", () => {
	const read = noteReader({
		"Tasks/Hotel.md": { roles: ["done", "todo", "doing", "cancelled"], links: [] },
	});
	const p = walkNoteProgress("Tasks/Hotel.md", read, { maxDepth: 3 });
	assert.equal(p.done, 1);
	assert.equal(p.total, 3); // cancelled is out of the denominator, as in roll-up
	assert.equal(p.notes, 1);
	assert.equal(p.depth, 1);
	assert.equal(p.truncated, false);
});
test("the walk descends into linked task-notes and rolls their checklists up", () => {
	const read = noteReader({
		"A.md": { roles: ["done"], links: ["B.md"] },
		"B.md": { roles: ["todo", "todo"], links: ["C.md"] },
		"C.md": { roles: ["done", "todo"], links: [] },
	});
	const p = walkNoteProgress("A.md", read, { maxDepth: 3 });
	assert.equal(p.total, 5);
	assert.equal(p.done, 2);
	assert.equal(p.notes, 3);
	assert.equal(p.depth, 3);
	assert.equal(p.truncated, false);
});
test("an unresolvable root note yields no signal at all", () => {
	assert.equal(walkNoteProgress("Nope.md", noteReader({}), { maxDepth: 3 }), null);
});
test("a cycle between notes terminates and counts each note exactly once", () => {
	const read = noteReader({
		"A.md": { roles: ["todo"], links: ["B.md"] },
		"B.md": { roles: ["todo"], links: ["A.md", "B.md"] },
	});
	const p = walkNoteProgress("A.md", read, { maxDepth: 10 });
	assert.equal(p.total, 2);
	assert.equal(p.notes, 2);
	assert.equal(read.reads.filter((r) => r === "A.md").length, 1);
});
test("a diamond counts the shared note once, not twice", () => {
	const read = noteReader({
		"A.md": { roles: [], links: ["B.md", "C.md"] },
		"B.md": { roles: ["todo"], links: ["D.md"] },
		"C.md": { roles: ["todo"], links: ["D.md"] },
		"D.md": { roles: ["todo", "todo"], links: [] },
	});
	const p = walkNoteProgress("A.md", read, { maxDepth: 5 });
	assert.equal(p.notes, 4);
	assert.equal(p.total, 4);
});
test("the depth cap stops the walk and says so", () => {
	const read = noteReader({
		"A.md": { roles: ["todo"], links: ["B.md"] },
		"B.md": { roles: ["todo"], links: [] },
	});
	const shallow = walkNoteProgress("A.md", read, { maxDepth: 1 });
	assert.equal(shallow.total, 1);
	assert.equal(shallow.notes, 1);
	assert.equal(shallow.truncated, true); // there IS more below
	assert.equal(read.reads.includes("B.md"), false); // and we never even read it

	const deep = walkNoteProgress("A.md", read, { maxDepth: 2 });
	assert.equal(deep.total, 2);
	assert.equal(deep.truncated, false);
});
test("the note budget stops a runaway link web", () => {
	const web = {};
	for (let i = 0; i < 30; i++) web[`n${i}.md`] = { roles: ["todo"], links: [`n${i + 1}.md`] };
	const p = walkNoteProgress("n0.md", noteReader(web), { maxDepth: 50, maxNotes: 5 });
	assert.equal(p.truncated, true);
	assert.ok(p.notes <= 5, `visited ${p.notes} notes with a budget of 5`);
});
test("pendingNoteWork is the open remainder, and 0 when there is no signal", () => {
	assert.equal(pendingNoteWork({ done: 2, total: 7, notes: 1, depth: 1, truncated: false }), 5);
	assert.equal(pendingNoteWork(undefined), 0);
});
test("note progress never touches roll-up", () => {
	const lines = ["- [ ] Parent", "\t- [x] Child"];
	const roots = parse(lines);
	// A parent whose only child is done rolls up to done; hanging an unfinished note
	// off it must not change that — the file stays recomputable from the file.
	roots[0].noteProgress = { done: 0, total: 9, notes: 3, depth: 2, truncated: false };
	computeRollup(roots, ROLLUP_OPTS);
	assert.equal(roots[0].effectiveRole, "done");
});
test("collectNoteWork surfaces only tasks with unfinished note work, biggest pile first", () => {
	const lines = ["- [ ] Alpha", "- [ ] Beta", "- [ ] Gamma"];
	const roots = parse(lines);
	roots[0].noteProgress = { done: 1, total: 3, notes: 1, depth: 1, truncated: false }; // 2 open
	roots[1].noteProgress = { done: 4, total: 4, notes: 1, depth: 1, truncated: false }; // none open
	roots[2].noteProgress = { done: 0, total: 6, notes: 2, depth: 2, truncated: false }; // 6 open
	const work = collectNoteWork(roots);
	assert.deepEqual(
		work.map((w) => w.node.text),
		["Gamma", "Alpha"],
	);
});

// ---- accent-insensitive matching --------------------------------------------
console.log("accent folding");
test("folding strips accents so 'dia' can find 'día'", () => {
	assert.equal(foldDiacritics("día"), "dia");
	assert.equal(foldDiacritics("Añadir reseña"), "Anadir resena");
	assert.equal(foldDiacritics("Über-Straße"), "Uber-Straße"); // ß is a letter, not an accent
});
test("folding preserves length, so match offsets still line up with the display text", () => {
	for (const s of ["día", "Añadir reseña", "café", "plain ascii", "🙂 emoji", "한국어", ""]) {
		assert.equal(
			foldDiacritics(s).length,
			displayForm(s).length,
			`length changed for ${JSON.stringify(s)}`,
		);
	}
});
test("a decomposed and a precomposed spelling fold to the same thing", () => {
	const precomposed = "caf\u00e9"; // é as a single code point
	const decomposed = "cafe\u0301"; // e + combining acute
	assert.notEqual(precomposed, decomposed); // genuinely different strings…
	assert.equal(foldDiacritics(precomposed), "cafe");
	assert.equal(foldDiacritics(decomposed), "cafe"); // …that a single query finds
});
test("folding leaves scripts whose decomposition is real letters alone", () => {
	assert.equal(foldDiacritics("한국어"), "한국어"); // not reduced to its jamo
	assert.equal(foldDiacritics("日本語"), "日本語");
});
test("folding is a no-op on text that has nothing to fold", () => {
	assert.equal(foldDiacritics("Website redesign 2026"), "Website redesign 2026");
});

// ---- generated-text templates -----------------------------------------------
console.log("templates");
test("starter tasks nest by indentation, tabs or spaces", () => {
	assert.deepEqual(parseStarterTasks("First task\n\tA subtask\nSecond task"), [
		{ depth: 0, text: "First task", status: " " },
		{ depth: 1, text: "A subtask", status: " " },
		{ depth: 0, text: "Second task", status: " " },
	]);
	assert.deepEqual(parseStarterTasks("Uno\n  Dos\n    Tres"), [
		{ depth: 0, text: "Uno", status: " " },
		{ depth: 1, text: "Dos", status: " " },
		{ depth: 2, text: "Tres", status: " " },
	]);
});
test("an over-indented line lands as a child, never as an orphan", () => {
	assert.deepEqual(parseStarterTasks("Root\n\t\t\t\tWay too deep"), [
		{ depth: 0, text: "Root", status: " " },
		{ depth: 1, text: "Way too deep", status: " " },
	]);
	assert.deepEqual(parseStarterTasks("\t\tIndented first line"), [
		{ depth: 0, text: "Indented first line", status: " " },
	]);
});
test("a starter line may carry its own checkbox, with or without a list marker", () => {
	assert.deepEqual(parseStarterTasks("[x] Done\n- [/] Doing\n- Plain\nBare"), [
		{ depth: 0, text: "Done", status: "x" },
		{ depth: 0, text: "Doing", status: "/" },
		{ depth: 0, text: "Plain", status: " " },
		{ depth: 0, text: "Bare", status: " " },
	]);
	assert.deepEqual(parseStarterTasks("[x]"), [], "a line that is only a checkbox has no task in it");
});
test("the SHIPPED template teaches roll-up in its first frame", () => {
	// The whole point of the default: a parent that is visibly not done, over a real
	// fraction. A template where nothing is marked never renders K/D at all, so every new
	// user's first board omitted the one mechanism no competing plugin copies.
	// The literal that actually ships, read out of settings.ts — a test that inlined its own
	// copy would keep passing after someone edited the default back to nothing marked.
	const src = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
	const shipped = /newBoardStarterTasks:\s*"((?:[^"\\]|\\.)*)"/.exec(src)?.[1];
	assert.ok(shipped, "could not find the shipped newBoardStarterTasks default");
	const lines = renderStarterTasks(JSON.parse(`"${shipped}"`), "\t");
	assert.deepEqual(lines, ["- [ ] First task", "\t- [x] A subtask", "\t- [ ] Another subtask", "- [ ] Second task"]);
	const roots = parse(lines);
	assert.equal(roots[0].progress.done, 1);
	assert.equal(roots[0].progress.total, 2);
	assert.equal(roots[0].effectiveRole, "doing", "half-finished reads as in flight, not done");
});
test("an empty starter template means a board with no tasks", () => {
	assert.deepEqual(parseStarterTasks(""), []);
	assert.deepEqual(parseStarterTasks("\n  \n\t\n"), []);
	assert.deepEqual(renderStarterTasks("", "\t"), []);
});
test("starter tasks render as task lines in the file's own indent style", () => {
	assert.deepEqual(renderStarterTasks("A\n\tB", "\t"), ["- [ ] A", "\t- [ ] B"]);
	assert.deepEqual(renderStarterTasks("A\n\tB", "    "), ["- [ ] A", "    - [ ] B"]);
});
test("note sections split on commas or newlines and tolerate a written-out heading", () => {
	assert.deepEqual(parseNoteSections("Progress, Status, Notes"), ["Progress", "Status", "Notes"]);
	assert.deepEqual(parseNoteSections("Avance\nEstado"), ["Avance", "Estado"]);
	assert.deepEqual(parseNoteSections("## Progreso, Notas"), ["Progreso", "Notas"]);
	assert.deepEqual(parseNoteSections("  ,  , "), []);
});
test("note sections render as headings with a blank line to write under", () => {
	assert.deepEqual(renderNoteSections("Avance, Notas"), ["## Avance", "", "## Notas", ""]);
	assert.deepEqual(renderNoteSections(""), []);
});

// ---- the published role table, against the SHIPPED defaults -------------------
// These run against DEFAULT_COLUMNS on purpose. Every other role test in this file uses
// the five-role COLS fixture above — a configuration no user ships with — which is
// exactly why the plugin shipped unable to read back characters it writes itself.
console.log("published roles vs shipped defaults");
test("every role round-trips through the DEFAULT column set", () => {
	for (const role of ["todo", "doing", "done", "cancelled", "blocked"]) {
		const ch = canonicalStatusForRole(role, DEFAULT_COLUMNS);
		assert.equal(
			roleForStatus(ch, DEFAULT_COLUMNS, "doing"),
			role,
			`wrote '${ch}' for ${role} and read it back as something else`,
		);
	}
});
test("the characters the agent contract publishes are honoured by the defaults", () => {
	assert.equal(roleForStatus("-", DEFAULT_COLUMNS, "doing"), "cancelled");
	assert.equal(roleForStatus("!", DEFAULT_COLUMNS, "doing"), "blocked");
});
test("a genuinely unknown character still falls back to unknownRole", () => {
	assert.equal(roleForStatus("?", DEFAULT_COLUMNS, "doing"), "doing");
	assert.equal(roleForStatus("~", DEFAULT_COLUMNS, "todo"), "todo");
});
test("a board's own columns still win over the published table", () => {
	const remapped = [
		{ id: "todo", name: "To Do", status: " ", role: "todo" },
		{ id: "wip", name: "WIP", status: "-", role: "doing" }, // claims '-' for doing
		{ id: "done", name: "Done", status: "x", role: "done" },
	];
	assert.equal(roleForStatus("-", remapped, "todo"), "doing");
});
test("a cancelled child no longer blocks its milestone under the shipped defaults", () => {
	// This is the shipped bug: '-' read as doing kept the parent forever incomplete.
	const roots = parse(["- [ ] Infrastructure", "\t- [x] Domain", "\t- [-] Dropped idea"], DEFAULT_COLUMNS);
	assert.equal(roots[0].effectiveRole, "done");
	assert.deepEqual(roots[0].progress, { done: 1, total: 1 });
});

// ---- lanes: a role with tasks always has somewhere to be ---------------------
console.log("board lanes");
test("every role is offered by the menu, even the ones with no column", () => {
	// The menu is built from boardLanes(columns, ALL_ROLES). Before that it iterated the
	// COLUMNS, so on a default board "Mark as Cancelled" did not exist: the plugin could
	// read `[-]`, the contract it installs told agents to write `[-]`, and the human it
	// belongs to could not produce one without editing settings.
	const offered = boardLanes(DEFAULT_COLUMNS, ALL_ROLES);
	assert.deepEqual(
		[...new Set(offered.map((c) => c.role))].sort(),
		[...ALL_ROLES].sort(),
		"a role the format defines must be reachable from the UI",
	);
	const cancelled = offered.find((c) => c.role === "cancelled");
	assert.equal(cancelled.status, "-", "and writing it must use the published character");
});
test("cancelled has no default lane, but never falls into To Do", () => {
	// The old fallback was `columns[0]` — the To Do lane — so work you had explicitly
	// decided not to do came back as the top of your backlog.
	assert.equal(
		DEFAULT_COLUMNS.some((c) => c.role === "cancelled"),
		false,
		"no permanent Cancelled lane on every board",
	);
	const lanes = boardLanes(DEFAULT_COLUMNS, ["todo", "cancelled"]);
	const lane = lanes.find((c) => c.role === "cancelled");
	assert.ok(lane, "a board WITH cancelled work draws the lane");
	assert.notEqual(lane.id, lanes[0].id);
});
test("a lane is earned once, and a user's own column keeps its name", () => {
	assert.equal(boardLanes(DEFAULT_COLUMNS, ["cancelled", "cancelled"]).length, DEFAULT_COLUMNS.length + 1);
	const mine = [{ id: "scrapped", name: "Scrapped", status: "-", role: "cancelled" }];
	assert.deepEqual(boardLanes(mine, ["cancelled"]), mine, "no synthetic lane shadows a real one");
});
test("a synthetic lane id cannot collide with a user's column id", () => {
	// Drop targets are matched by id; a collision would route a card to the wrong write.
	const collide = [{ id: "cancelled", name: "Nope", status: "z", role: "todo" }];
	const lanes = boardLanes(collide, ["cancelled"]);
	assert.equal(new Set(lanes.map((c) => c.id)).size, lanes.length);
});

// ---- what a board shows when it opens ----------------------------------------
console.log("folding");
const FOLD = (openDepth, collapsed = [], expanded = []) => ({
	openDepth,
	collapsed: new Set(collapsed),
	expanded: new Set(expanded),
});
const DEEP = [
	"- [ ] Design ^t-d",
	"\t- [ ] Wireframes ^t-w",
	"\t- [ ] Visual language ^t-v",
	"\t\t- [ ] Typography ^t-ty",
	"\t\t- [ ] Colour ^t-c",
	"- [ ] Ship ^t-s",
];
test("a board opens two levels deep — roots and their children, nothing below", () => {
	const rows = visibleNodes(parse(DEEP), FOLD(2)).map((n) => n.text);
	assert.deepEqual(rows, ["Design", "Wireframes", "Visual language", "Ship"]);
});
test("the off-by-one: openDepth 1 shows only roots, 3 shows grandchildren", () => {
	assert.deepEqual(
		visibleNodes(parse(DEEP), FOLD(1)).map((n) => n.text),
		["Design", "Ship"],
	);
	assert.equal(visibleNodes(parse(DEEP), FOLD(3)).length, 6);
});
test("an explicit choice outranks depth in BOTH directions", () => {
	// This is why folding had to become tri-state: without an `expanded` set, unfolding a
	// deep branch would silently re-fold the next time the depth default was applied.
	const opened = visibleNodes(parse(DEEP), FOLD(2, [], ["t-v"])).map((n) => n.text);
	assert.ok(opened.includes("Typography"), "hand-opened branch stays open");
	const shut = visibleNodes(parse(DEEP), FOLD(2, ["t-d"])).map((n) => n.text);
	assert.deepEqual(shut, ["Design", "Ship"], "hand-folded root stays shut");
});
test("isFolded ignores childless nodes' depth for rendering purposes", () => {
	const roots = parse(DEEP);
	const leaf = roots[0].children[0]; // Wireframes, depth 1, no children
	assert.equal(isFolded(leaf, FOLD(2)), true, "the predicate is purely about depth…");
	assert.deepEqual(
		visibleNodes(roots, FOLD(2)).map((n) => n.text).filter((t) => t === "Wireframes"),
		["Wireframes"],
		"…and a node with nothing to hide is still shown",
	);
});
test("a fully expanded board equals the flattened tree", () => {
	const roots = parse(DEEP);
	const all = flattenAll(roots).map((n) => n.text);
	assert.deepEqual(visibleNodes(roots, FOLD(99)).map((n) => n.text), all);
});
test("depth is measured from the view root, so focusing a branch opens it", () => {
	// Focus scopes the view to one node; that node keeps its board depth. Without a base,
	// focusing "Visual language" (depth 1) would render it as the single row you asked for
	// and then hide everything under it — the exact opposite of what focus means.
	const vl = parse(DEEP)[0].children[1];
	assert.equal(isFolded(vl, FOLD(2)), true, "deep in the board: folded");
	assert.equal(
		isFolded(vl, { ...FOLD(2), baseDepth: vl.depth }),
		false,
		"as the view root: open",
	);
	assert.deepEqual(
		visibleNodes([vl], { ...FOLD(2), baseDepth: vl.depth }).map((n) => n.text),
		["Visual language", "Typography", "Colour"],
	);
});
test("no layout reads the fold sets behind isCollapsed's back", () => {
	// The whole point of one hiding gesture is that every layout hides the same thing. The
	// diagram once tested `collapsed.has(id)` directly, so it drew an open branch under a
	// chevron pointing right: the icon read the depth default, the recursion didn't. The
	// sets may only be WRITTEN outside the accessor — reads go through isCollapsed().
	const view = readFileSync(new URL("../src/views/tree-view.ts", import.meta.url), "utf8");
	const reads = [...view.matchAll(/this\.(?:collapsed|expanded)\.has\(/g)];
	assert.equal(reads.length, 0, "found a raw fold-set read; call this.isCollapsed(node)");
});

// ---- derived state is not the user's to set directly -------------------------
console.log("derived state");
test("isDerived matches computeRollup exactly — task children, not isLeaf", () => {
	// The trap: `isLeaf` counts non-task bullets, so a task carrying a plain note bullet
	// is not a leaf — yet its state is entirely its own and its checkbox must still work.
	const roots = parse(["- [ ] Has a note bullet", "\t- just a note", "- [ ] Has a subtask", "\t- [ ] Real child"]);
	const [noteOnly, realParent] = roots;
	assert.equal(noteOnly.isLeaf, false, "a non-task bullet still makes it a non-leaf");
	assert.equal(isDerived(noteOnly), false, "…but its state is its own, so it stays settable");
	assert.equal(isDerived(realParent), true);
	assert.equal(isDerived(realParent.children[0]), false);
});
test("a derived node's state really is a function of its children", () => {
	const roots = parse(["- [ ] Milestone", "\t- [x] One", "\t- [x] Two"]);
	assert.equal(isDerived(roots[0]), true);
	assert.equal(roots[0].effectiveRole, "done");
	assert.equal(roots[0].statusChar, " ", "the parent's own character was never touched");
});
test("the only way a parent disagrees with its children is a visible override", () => {
	const plain = parse(["- [ ] Milestone", "\t- [ ] Loose end"]);
	assert.equal(plain[0].effectiveRole, "todo");
	const overridden = parse(["- [x] Milestone [tt-override:: done] ^t-m", "\t- [ ] Loose end"]);
	assert.equal(overridden[0].effectiveRole, "done");
	assert.equal(overridden[0].derivedRole, "todo", "the derivation is still visible underneath");
	assert.equal(overridden[0].override, "done", "and the disagreement is written on the line");
});
test("a dependency hold never becomes the blocked ROLE", () => {
	// If it did, a parent would read `doing` from roll-up while its child read `blocked`
	// from the renderer — and dragging out of a Blocked column would write a character
	// that was never true.
	const roots = parse(["- [ ] Staging ^t-s", "- [ ] QA [tt-blocked-by:: t-s] ^t-qa"]);
	resolveEdges(roots);
	assert.equal(roots[1].isDependencyBlocked, true);
	assert.equal(roots[1].effectiveRole, "todo", "held, but its role is untouched");
	assert.equal(roots[1].statusChar, " ");
});

// ---- a board that says what it means -----------------------------------------
console.log("self-describing boards");
test("the shipped defaults need no tt_columns — the published table already says this", () => {
	assert.equal(deviatesFromPublished(DEFAULT_COLUMNS), false);
});
test("adding the standard Blocked / Cancelled columns still needs no stamp", () => {
	// Their meaning is published, so writing it into every board would be pure churn.
	assert.equal(deviatesFromPublished(COLS), false);
});
test("a genuinely remapped board deviates and must be stamped", () => {
	assert.equal(
		deviatesFromPublished([
			{ id: "todo", name: "To Do", status: " ", role: "todo" },
			{ id: "wip", name: "WIP", status: ">", role: "doing" }, // '>' is nobody's published char
			{ id: "done", name: "Done", status: "x", role: "done" },
		]),
		true,
	);
	assert.equal(
		deviatesFromPublished([
			{ id: "a", name: "Odd", status: "x", role: "todo" }, // 'x' published as done
		]),
		true,
	);
});
test("a stamped board is read back exactly as written, ignoring the vault default", () => {
	const stamped = { tt_columns: [{ name: "WIP", status: ">", role: "doing" }] };
	const cols = columnsFromFrontmatter(stamped, DEFAULT_COLUMNS);
	assert.equal(cols.length, 1);
	assert.equal(roleForStatus(">", cols, "todo"), "doing");
});

// ---- an unmapped character says so -------------------------------------------
console.log("unmapped characters");
test("a character nobody claims is reported as unmapped, not silently guessed", () => {
	const r = resolveStatus("?", DEFAULT_COLUMNS, "doing");
	assert.equal(r.mapped, false);
	assert.equal(r.role, "doing"); // still the published fallback, just not silent
});
test("claimed and published characters are mapped", () => {
	assert.equal(resolveStatus("x", DEFAULT_COLUMNS, "doing").mapped, true);
	assert.equal(resolveStatus("-", DEFAULT_COLUMNS, "doing").mapped, true); // published
	assert.equal(resolveStatus("!", DEFAULT_COLUMNS, "doing").mapped, true); // published
});
test("the parser flags the node so a view can show it", () => {
	const roots = parse(["- [?] Mystery", "- [x] Known"], DEFAULT_COLUMNS);
	assert.equal(roots[0].statusMapped, false);
	assert.equal(roots[1].statusMapped, true);
});

// ---- "next up" means NOW -----------------------------------------------------
console.log("next up");
test("a dependency-held leaf is not recommended as actionable", () => {
	const lines = ["- [ ] Staging box ^t-staging", "- [ ] QA pass [tt-blocked-by:: t-staging] ^t-qa"];
	const roots = parse(lines);
	resolveEdges(roots); // sets isDependencyBlocked
	const next = collectNextUp(roots).map((i) => i.node.text);
	assert.ok(next.includes("Staging box"), "the unblocked leaf should be actionable");
	assert.ok(!next.includes("QA pass"), "a task the panel calls blocked must not also be 'next up'");
});
test("leaves under an explicitly cancelled ancestor are not recommended", () => {
	const roots = parse(["- [-] Dropped branch [tt-override:: cancelled] ^t-d", "\t- [ ] Buried task", "- [ ] Live task"]);
	resolveEdges(roots);
	assert.deepEqual(
		collectNextUp(roots).map((i) => i.node.text),
		["Live task"],
	);
});
test("a parent merely TYPED [-] does not silence its children — children win in roll-up", () => {
	// Roll-up lets children override a parent's own character, so this parent reads todo.
	// Only an explicit [tt-override:: cancelled] states intent about the branch.
	const roots = parse(["- [-] Looks dropped", "\t- [ ] Still live", "- [ ] Other"]);
	resolveEdges(roots);
	assert.equal(roots[0].effectiveRole, "todo");
	assert.deepEqual(
		collectNextUp(roots).map((i) => i.node.text),
		["Still live", "Other"],
	);
});
test("leaves under an explicitly overridden-done ancestor are not recommended", () => {
	const roots = parse(["- [x] Infrastructure [tt-override:: done] ^t-i", "\t- [ ] Staging box", "- [ ] Live task"]);
	resolveEdges(roots);
	assert.deepEqual(
		collectNextUp(roots).map((i) => i.node.text),
		["Live task"],
	);
});

// ---- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
