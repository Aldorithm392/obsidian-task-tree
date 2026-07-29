// The vault teaches the agent. With one-time consent, the plugin maintains agent
// instructions INSIDE the vault: a managed AGENTS.md section (read by Claude Code,
// Cursor, Codex, …) and a project-level Claude Code skill. Both are bundled into
// main.js at build time from the same files the conformance tests pin to the parser
// — the embedded teaching can never drift from what the code actually does.

import { TFile } from "obsidian";
import type TaskTreePlugin from "./main.ts";
import CONTRACT_MD from "../docs/agent/CONTRACT.md";
import SKILL_MD from "../skills/task-tree/SKILL.md";

/** Bump when the embedded instructions change meaningfully — a bump re-stamps once. */
const SECTION_VERSION = 2;
const BEGIN = `<!-- task-tree:agents:v${SECTION_VERSION}:begin -->`;
const ANY_BEGIN_RE = /<!-- task-tree:agents:v\d+:begin -->/;
const END = "<!-- task-tree:agents:end -->";

const SECTION_BODY = `${BEGIN}
<!-- This section is maintained by the Task Tree plugin. Edits inside it will be
     overwritten on plugin updates; write your own instructions OUTSIDE the markers. -->

# Working with Task Tree boards in this vault

Some notes here are **Task Tree boards**: nested Markdown checklists with roll-up
progress, stable block ids, and dependencies. Before editing tasks, know the rules:

1. **The gate:** only treat a note as a board if its frontmatter has \`type: task-tree\`.
   Notes with \`type: task-note\` are a task's own page — edit their content freely, but
   their structural frontmatter (\`title\`, \`board\`, \`parent\`, \`depth\`, \`path\`,
   \`distance_to_main\`, \`task_id\`, \`task_status\`) is plugin-managed and will be
   reconciled automatically; don't hand-edit it.
2. **Change state on leaves** (flip the char inside \`[ ]\`); a parent's state derives
   from its children — never mark a parent done directly. \`[tt-override:: role]\` on a
   line is an explicit human decision: respect it.
3. **Preserve every \`tt-\` field and trailing \`^id\`** when rewriting a line; never
   invent or reuse ids (the plugin assigns them). Never write progress counts.
4. **Restructure (move/indent) and state changes are separate edits.** Match the file's
   indentation unit. A task's own note is its **trailing** \`[[wikilink]]\`.
5. Dependencies: \`[tt-blocked-by:: t-id1, t-id2]\` — bare block ids on the same board;
   released when the target task is done/cancelled.
6. **Detail belongs in the task's note.** A task-note can carry its own \`- [ ]\` checklists
   and link to deeper task-notes; the plugin surfaces that as a read-only depth badge on
   the board task. It never feeds roll-up and never flips a board status character, so
   writing checklists into notes is safe — and better than flattening them onto the board.

The plugin reconciles task-note frontmatter automatically after your edits — you may
restructure boards freely; positions in note YAML self-heal on the next render.

The full machine-readable contract follows.

${CONTRACT_MD.trim()}

${END}`;

async function ensureAgentsFile(plugin: TaskTreePlugin): Promise<boolean> {
	const { vault } = plugin.app;
	const existing = vault.getAbstractFileByPath("AGENTS.md");
	if (existing instanceof TFile) {
		const text = await vault.cachedRead(existing);
		if (text.includes(BEGIN)) return false; // current version already present
		await vault.process(existing, (d) => {
			const beginMatch = ANY_BEGIN_RE.exec(d);
			const endIdx = d.indexOf(END);
			if (beginMatch && endIdx >= 0) {
				// Replace ONLY our managed section; the user's own content is untouched.
				return d.slice(0, beginMatch.index) + SECTION_BODY + d.slice(endIdx + END.length);
			}
			return d.trimEnd() + "\n\n" + SECTION_BODY + "\n";
		});
		return true;
	}
	await vault.create("AGENTS.md", SECTION_BODY + "\n");
	return true;
}

async function ensureVaultSkill(plugin: TaskTreePlugin, force: boolean): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const dir = ".claude/skills/task-tree";
	const skillPath = `${dir}/SKILL.md`;
	if (!force && (await adapter.exists(skillPath))) return;
	// adapter.mkdir is single-level; walk the chain, tolerating "already exists".
	for (const d of [".claude", ".claude/skills", dir, `${dir}/reference`]) {
		try {
			await adapter.mkdir(d);
		} catch {
			// exists — fine
		}
	}
	await adapter.write(skillPath, SKILL_MD);
	await adapter.write(`${dir}/reference/contract.md`, CONTRACT_MD);
}

/**
 * Idempotent and cheap: creates or refreshes the managed AGENTS.md section and the
 * in-vault Claude Code skill. A section-version bump refreshes both, once.
 */
export async function ensureAgentInstructions(plugin: TaskTreePlugin): Promise<void> {
	try {
		const refreshed = await ensureAgentsFile(plugin);
		await ensureVaultSkill(plugin, refreshed);
	} catch (e) {
		console.error("Task Tree: could not maintain agent instructions", e);
	}
}
