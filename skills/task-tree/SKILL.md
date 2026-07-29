---
name: task-tree
description: >
  Read, edit, and reason about Task Tree boards — nested Markdown checklists in an Obsidian vault
  with roll-up progress, block ids, and dependencies. Use when the user mentions a Task Tree board,
  an Obsidian task list or Kanban in Markdown, nested checklist tasks, roll-up progress, blocked
  tasks or dependencies between tasks, breaking a project or goal into subtasks, task-notes, or
  managing project documentation as Markdown checklists (`type: task-tree` files).
---

# Task Tree — operating an agent-ready Markdown task board

A Task Tree board is a plain Markdown note: frontmatter `type: task-tree`, then one nested
checklist. Parents derive their state from children (roll-up); every task can carry a stable `^id`,
a manual `[tt-override:: role]`, dependencies `[tt-blocked-by:: id, id]`, and its own linked note.
The full rules are in [reference/contract.md](reference/contract.md) — **read it before writing to
a board.** The three iron rules:

1. Only touch files whose frontmatter says `type: task-tree` (boards) — task-note frontmatter is
   plugin-managed.
2. Preserve every `tt-` field and `^id` when rewriting a line; never invent or reuse ids.
3. Change state on **leaves**; parents follow by roll-up. One structural edit per write.

## Recipes

### Survey a vault
Find every board: grep for `type: task-tree` in frontmatter across `*.md`. For each, compute
roll-up (post-order; rules in the reference) and report: total tasks, done, doing, blocked, and the
top-level milestones with their derived states. Never store computed progress in the files.

### Report status of one board
Parse the checklist into a tree by indentation. Compute each parent's role bottom-up. Summarize as
the human thinks: milestones with `K/D` progress, what's in flight, what's blocked and *why*
(the blocked leaf + its ancestor path).

### "What's blocked, and why?"
Two sources, report both:
- **Status blockers**: leaves whose char maps to `blocked` (`!` by default) — name the leaf and its path.
- **Dependency holds**: tasks with `[tt-blocked-by:: …]` whose targets aren't `done`/`cancelled`
  — name what they wait on. Flag unknown ids and cycles; never silently drop them.

### Break a goal into subtasks
Add nested `- [ ]` lines under the parent, one indent unit deeper (match the file's unit — tab by
default). Propose the decomposition first if the user hasn't specified it; structure is the
human's call. Don't add ids by hand — the plugin auto-assigns them (or run its "Assign block IDs"
command).

### Mark work done — and explain what rolled up
Flip the leaf's char to `x` (Operation B: exactly that character, nothing else on the line).
Then recompute the ancestors and tell the user what changed: "*Staging box* done → *Infrastructure*
2/2 → its override is now redundant" or "*QA pass* released *Announcement post*'s dependency."

### Record detail without cluttering the board
A task's own note (its **trailing** `[[wikilink]]`, `type: task-note`) can hold its own `- [ ]`
checklists and link to further task-notes. The plugin follows that trail and badges the board task
with what it finds — read-only: roll-up never sees it and no status character changes because of
it. So when a task needs fine-grained steps that the human doesn't want on the board, put them in
the note as checklists. They stay visible as depth instead of disappearing into prose.

When reporting, say where the work lives: "*Migration* reads 1/3 on the board, and its note carries
7 more open items across two linked notes."

### Wire a dependency
Append `[tt-blocked-by:: <target-id>]` before the task's trailing `^id` (comma-separate multiple
ids). Targets are bare block ids on the same board. Check you're not creating a cycle.

### Build a board from existing docs
From a project's Markdown docs, draft a board: `---\ntype: task-tree\ntitle: "<name>"\n---`, then
the checklist — milestones as top-level tasks, concrete actions as leaves. Statuses only where the
docs are explicit; everything else `[ ]`. Show the draft before writing the file, and let the
plugin assign ids afterward.

### Keep board and reality in sync
On request, diff what the docs/conversation say happened against the board: leaves to flip, new
tasks to add, tasks that look cancelled. Apply leaf flips freely; propose structural changes and
cancellations — those are the human's.

## Installing this skill

Copy this folder into your agent's skills directory, e.g. `~/.claude/skills/task-tree/`.
