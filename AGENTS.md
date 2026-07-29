# AGENTS.md — how to operate a Task Tree board

This file is for an AI agent **working with a user's Task Tree boards** (nested Markdown checklists
in an Obsidian vault). To *develop the plugin itself*, read [CLAUDE.md](CLAUDE.md) instead.
Machine-readable grammar tables: [docs/agent/CONTRACT.md](docs/agent/CONTRACT.md).

## The gate — read this first

**Only read or edit a file whose YAML frontmatter contains `type: task-tree`.** Never treat any
other file as a board. Task-notes are marked `type: task-note`; edit their *content* freely below
the frontmatter, but leave their structural frontmatter (`parent`, `depth`, `path`,
`distance_to_main`, `task_id`, `board`, `task_status`) to the plugin — it reconciles those keys
automatically on every render, so restructure boards freely and note positions self-heal.
`task_status: orphaned` means the note's task was deleted from its board.

## The task line

```
<indent><marker> [<status>] <text> [tt-override:: <role>]? [tt-blocked-by:: <id>, <id>…]? ^<id>?
```

- `<indent>`: one unit per depth level — **match the file's existing style** (tab by default).
- `<marker>`: `-`, `*`, or `+`. Preserve it when rewriting a line.
- `<status>`: one character inside `[ ]`. Default mapping: `" "` todo · `/` doing · `x` done ·
  `-` cancelled · `!` blocked. A board can remap via `tt_columns` in its frontmatter — check there
  first.
- `[tt-override:: <role>]`: an explicit human decision. Respect it; never remove or contradict it
  without being asked.
- `[tt-blocked-by:: <id>, <id>]`: dependency edges — bare block ids of tasks on the same board.
  Released when the target is `done`/`cancelled`; otherwise the task is waiting.
- `^<id>`: stable block id, **always the last token**.

## Roll-up — how to compute any parent's state (no plugin needed)

Post-order, children first:

1. Has `[tt-override:: R]` → the state is `R`. Stop.
2. No task children → the state is its own status char's role (leaf).
3. Else, over non-cancelled task children: all `done` → `done`; any `blocked` → `blocked`;
   any started → `doing`; else `todo`. (All children cancelled → `cancelled`.)

Progress `K/D` is **derived, never stored**. Do not write progress counts into the file.

## The two operations — never mix them in one edit

- **Operation A (restructure):** move a whole subtree — the children travel with it; only indent
  and position change. Everything else on every moved line stays byte-identical.
- **Operation B (state change):** flip exactly one status character in place.

One structural edit per write. Keep them separate and each edit stays reviewable and reversible.

## Invariants — never break these

1. **Never regenerate, reuse, or invent block ids.** Existing `^ids` are permanent.
2. **Preserve every `tt-` field and the `^id` when rewriting a line's text.**
3. **Never write progress counts** (`3/7`, percentages) into the file — they are rendered, not stored.
4. **No Tasks-plugin emoji metadata** (📅 ⏳ 🛫 ✅ 🔁 …). Only `tt-`-namespaced fields.
5. **No version stamps** (`okf_version`, `tt_version`) in frontmatter — it carries user-useful data only.
6. **Match the file's indentation unit** — don't convert tabs↔spaces.
7. **A task's own note is its *trailing* `[[wikilink]]`.** A link earlier in the text is a
   cross-reference, not the task-note. Don't append a second trailing link.
8. **Don't mark a parent's checkbox done.** Finish the leaves; the parent's state follows from
   roll-up. If a milestone must close with loose ends, that's what `[tt-override:: done]` is for —
   an explicit, visible decision.

## Dependencies

To find what holds a task up: collect its `tt-blocked-by` ids, look up those tasks (grep `^<id>`),
check their effective roles. `done`/`cancelled` release the edge. Report unknown ids rather than
deleting them. Don't create cycles.

## Depth: checklists inside task-notes

A task's own note may carry its own `- [ ]` checklists and link to further `type: task-note` notes,
which may do the same. The plugin follows that trail and badges the board task with the progress it
finds — a **separate, read-only signal**: it never changes a status character, and roll-up never
sees it. So writing detail as checklists inside a task-note is safe and visible; it does not need
to be flattened onto the board to count. Keep the board at the altitude the human thinks at, and
put the fine grain in the note.

## Division of labor with the human

- **The human owns intent and structure**: what the project is, how it decomposes, what gets
  cancelled. Propose decompositions as suggestions; apply them when asked.
- **You own legwork on the leaves**: flip leaf states as work completes, add subtasks under a parent
  the human named, follow dependency chains, summarize blockers.
- **Report in tasks, not diffs**: "Marked *Staging box* done; *Infrastructure* now reads 2/2 and
  *QA pass* is unblocked" — the human thinks in the tree, not in line numbers.
- When in doubt whether an edit is structural (A) or state (B), or whether a human decision
  (override, cancellation) is yours to change: **ask**.
