# 🧩 Phase 1 · Planning

> **Goal:** think it through before coding. This captures the idea, the mental model, the scope, and
> the stack for Task Tree.
> ↩︎ Back to the [Project Guide](PROJECT_GUIDE.md)

---

## 1. What am I building?

**Task Tree for Obsidian** — a task manager that lets you break a project into a *tree* of tasks
(task → subtask → sub-subtask, arbitrarily deep) while also seeing the same work as a **Kanban
board**. Everything is plain Markdown checklists; the plugin is a visualization + write-back layer.

**Main objective — cognitive clarity, not features.** Every node is a small milestone that keeps you
anchored to the big picture while you work in the weeds. The observation that motivates it: real
projects are rarely linear, and flat tools fight the way people actually decompose work.

**Milestones (MVP):** parse nested tasks → tree view (collapse/expand/focus) → Kanban view whose
drags write back → roll-up parent state with a progress signal → zero AI infrastructure (compatibility
is just clean Markdown) → a visible "freedom, announced" note.

---

## 2. The core mental model — three axes

A task lives in three orthogonal dimensions, and the plugin shows all three:

| Axis | Question | Where |
|------|----------|-------|
| **X** | What state? | Kanban column |
| **Y** | What order within the state? | Vertical position |
| **Z** | Child of what? How deep? | Tree nesting |

Kanban owns X and Y; the tree owns Z. They aren't two tools glued together — they are three faces of
the same task. This fusion of **structure (tree)** and **state (Kanban)** in one navigable view is the
actual differentiator; "a task tree" alone is not.

### The hard design decision: who owns a parent's state?

**Children do (roll-up).** A parent's state is derived — `done` only if all children are done,
`doing` if any started, else `todo` — so a parent can never lie about being complete. The exception
is a **visible manual override** (`[tt-override:: role]`) for "I decide this milestone is closed even
with loose ends." Default is deterministic; the exception is marked. Full rules in
[`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md).

Two gestures are kept distinct: **restructure** (move a branch; children travel) vs. **change state**
(one node; children don't). Conflating them is the root of most confusion.

---

## 3. Non-goals (what we deliberately don't do)

- **No reconciliation engine** between human and agent. Freedom is the user's administration; the
  plugin's job is to *not break* clean Markdown, not to police structure.
- **No private format.** Align with existing Obsidian/Tasks status conventions; add only a small,
  namespaced override field.
- **No AI infrastructure.** No API keys, no model calls, no cost. LLM-compatibility is a pleasant
  property of doing the Markdown well (see [`04_OKF_AND_AGENTS.md`](04_OKF_AND_AGENTS.md)).
- **No forced folder structure.** Total user freedom, announced not assumed.

---

## 4. Engineering design (the stack)

- **Platform:** Obsidian plugin API (desktop + mobile), TypeScript, bundled with esbuild to a CJS
  `main.js`. Min app version 1.5.0.
- **Reading tasks:** Obsidian's `metadataCache.listItems` (positions, `task` char, `id`, `parent`),
  reconstructed into an in-memory tree. No regex-parsing of the whole file for structure.
- **Writing back:** `vault.process` atomic read-modify-write; status flips are length-preserving,
  restructures cut/re-indent/splice a contiguous range.
- **Views:** two `ItemView`s (Kanban, Tree); drag-and-drop via **SortableJS** (~45 KB, bundled).
- **State identity:** Obsidian block ids (`^id`), auto-assigned to every task in a managed board.
- **No database, no backend, no AI models.** The Markdown *is* the database.

**Architecture split that keeps it testable:** all core logic (`src/model/**`) is pure (no Obsidian
import), so it runs under Node for unit tests; the Obsidian API is confined to `main.ts`, `settings`,
`board-controller`, and `views/**`.

---

## 5. Risks acknowledged

- **Crowded space** (Tasks, Kanban, Dataview). The answer is the tree+Kanban fusion, not "a task list."
- **Deep hierarchy is a usability problem, not just technical.** Collapse/expand and branch-focus must
  be genuinely good or the very problem we solve reappears inside the tool.
- **Maintenance is a commitment.** People trust the plugins that stay maintained.

---

✅ **End of Phase 1:** clear objective, the three-axis model, a decided stack, and a designed format —
carried into [`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md) and the working memory in `../CLAUDE.md`.
