// Pure-logic tests for Task Tree. Runs under Node's native TypeScript type
// stripping (Node >= 23.6) with zero dependencies:  `node tests/run.mjs`.

import assert from "node:assert/strict";
import { parseLine } from "../src/model/line.ts";
import { buildTree } from "../src/model/parser.ts";
import { computeRollup } from "../src/model/rollup.ts";
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
} from "../src/model/writer.ts";
import { DEFAULT_COLUMNS, validateColumns } from "../src/columns.ts";
import { generateId } from "../src/model/ids.ts";
import {
	computeSummary,
	collectBlockers,
	collectNextUp,
	markBlockedPaths,
} from "../src/model/insights.ts";

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

// ---- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
