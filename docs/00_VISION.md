# 🌳 Task Tree — Vision & Reset (source of truth)

> Everything we've decided, captured so it isn't lost. This is the "we're resetting our own tool"
> document — the north star. When in doubt, this wins.
> ↩︎ [Project Guide](PROJECT_GUIDE.md) · [Format spec](03_FORMAT_SPEC.md) · [OKF & agents](04_OKF_AND_AGENTS.md)

## The one-line idea

A task manager that renders a **normal nested Markdown checklist** as a **tree** and a **Kanban board**,
so every node is a small milestone and you never lose the big picture. Plain Markdown, agent-ready.

## The three layers (the mental model that unlocks everything)

One structure, three layers over it:

1. **Structure — the shared source of truth.** A Markdown note: its **title is the project**, the nested
   `- [ ]` list is the tasks. Everything lives here, readable and portable with or without the plugin.
2. **Human layer — the plugin.** A visualizer that lets you **do everything from the view** — write,
   create, move, nest, delete, connect — *without ever opening the raw file*. The plugin also **manages
   the files for you** (creating notes, folders): you think in tasks, not in `.md`.
3. **LLM layer.** An agent reads the **raw Markdown** directly; a parent's state is recomputable from the
   leaves. No plugin needed. The clean, consistent structure is what makes it legible.

**Principle:** *Human first, LLM second — but naturally compatible.* The same Markdown serves both.
(Original wording: "Markdown is the single source of truth," "the plugin is a visualization layer,"
"LLM-compatibility is a property, not a feature.")

## What the reset taught us

- The tool is a **clarity view over a normal subtask list** — not a database, not a new app. Keep it
  simple; the dashboard/stats are opt-in, never the front door.
- The human must be able to **edit the whole note from any view**. Being sent to the raw file is the
  friction to eliminate.
- The plugin should **own file creation/management** so the human never thinks about files.

## Backlog — the full picture (priority order)

### ✅ Shipped
- Parse nested Markdown checklist tasks → in-memory tree; **roll-up** parent state from children;
  progress signal; **manual override** (`[tt-override:: role]`); stable **block ids** (`^t-…`).
- Views: **Kanban** (drag = change state), **Tree** with **three layouts** — List / horizontal
  **Diagram** / **Columns** (drill-down) — a **full-focus** pane, collapse/focus.
- Editing from the UI: status toggle, add/delete/rename/tag, **inline + / −** on every node, drag
  (grip handle, list) + deterministic **Move up/down / Indent / Outdent**.
- Clean-by-default view (stats opt-in); OKF-aligned format; 38 pure-logic tests.

### 🔜 Now — "edit everything from the view; the plugin owns the files"
1. **Inline text editing in every view.** Click a task and *write on it* (list, diagram, columns,
   kanban). Enter saves, Esc cancels. Never jump to the raw file. Create/move/nest/delete already work
   from every view; this closes the loop.
2. **The plugin creates & manages files.** A **"New board from zero"** command that creates the `.md`
   with frontmatter; a **default-folder setting** (where new notes go); **YAML `title` = note title**
   (renaming the board renames the file, links preserved). The human never touches files.

### 🌐 Next — "task = note"
3. **Open any task as its own note.** Create/open a linked note (`[[…]]`) per task for **progress,
   status, code, notes** — in the configured folder. "Obsidian's graph network, seen as a work tree."
4. **Each task-note is self-describing (OKF concept).** Its YAML frontmatter tells an agent how to read
   it and *where it sits* without reconstructing the tree: `type`, `parent` (link to the parent task's
   note), and its position — `depth`, `path` from the root, and `distance` to the main task. (Literal
   diagram X/Y is layout-derived and not stored — the tree structure *is* the position.) This is the
   bridge to the graph: `parent` is the first edge.

### 🧠 Advanced (deliberately later — user's call)
4. **Connect tasks to each other** — dependencies / relationships between tasks across the tree (the
   real graph: "task A is blocked by / relates to task B"). Represented in Markdown as links so agents
   read it too. Big feature; its own phase.

### 🚢 Ship
- Fill `author`/GitHub handle in `manifest.json`; manual QA in a real vault; tag a release; submit to
  the community plugin directory.

## Non-negotiables (guardrails)

- **Markdown stays the source of truth.** Every action writes back to the same file, legibly.
- **Total freedom, announced.** Don't impose structure; the opt-in gate is `type: task-tree`.
- **Never surprise the human's files silently** — creation/rename is explicit and predictable.
- **Agent-legible by construction** — clean nesting, roles recomputable from leaves, ids stable.
