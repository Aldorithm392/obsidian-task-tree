# Task Tree for Obsidian

**A task manager that is simple, but on steroids.** Task Tree lets you break a project into a
*tree* of tasks — task → subtask → sub-subtask, as deep as you think — while also seeing the same
work as a **Kanban board**. Everything is plain Markdown. The plugin is a visualization layer over
your `- [ ]` checklists, not a database and not a new format.

The point isn't "another task app." It's **cognitive clarity**: every node is a small milestone that
keeps you anchored to the big picture while you work in the weeds.

> Real projects are rarely linear. A task grows subtasks, and each of those grows subtasks in turn.
> Most tools flatten that into a list, or allow one level of nesting, and the friction is exactly
> what Task Tree removes.

---

## The three axes

A task lives in three orthogonal dimensions, and Task Tree shows all three:

| Axis | Question | Where you see it |
|------|----------|------------------|
| **X** | What *state* is it in? | Kanban column |
| **Y** | What *order* within that state? | Vertical position |
| **Z** | What is it a *child of*? | Tree nesting |

Kanban handles X and Y. The tree handles Z. Same task, three faces.

---

## Freedom, announced — please read this

Task Tree gives you **total freedom** over how you organize and move your tasks — like Obsidian
itself, it hands you a canvas and trusts your method. There is exactly one thing to know:

> **Task Tree only manages files that opt in** by adding `type: task-tree` to their frontmatter.
> Every other checklist in your vault is never touched. Inside a managed board you're free to
> organize however you like — but any choice a reader (human *or* AI) can't infer from universal
> Markdown convention is written down *in the file*: non-standard columns live in the board's own
> frontmatter, and a deliberately overridden state is marked with a visible `[tt-override:: …]` right
> on the task. Task Tree writes only four things to a task line — its status character, its `^id`,
> (on override) that marker, and (on request) a `[tt-blocked-by:: …]` dependency — and leaves
> everything else verbatim.

That's the whole contract. **Total freedom — but announced, not assumed.** If you also point an AI
agent (e.g. Claude Code) at your vault and you've overridden the default behavior by hand, just tell
the agent, or leave a note in the file. Nothing to encode.

---

## What a board looks like

````markdown
---
type: task-tree
title: Website Redesign
description: Q3 marketing-site rebuild.
tags: [project, marketing]
---

- [/] Analytics wiring ^t-77e1
	- [x] GA4 base tag ^t-5d21
	- [ ] Conversion events ^t-0f18
- [x] Domain + hosting [tt-override:: done] ^t-aa10
	- [ ] Set up staging box ^t-9d31
````

- **Roll-up:** a parent's state is *derived* from its children — `Done` only when all children are
  done, `Doing` when any child has started, otherwise `To Do`. Partial progress shows as a signal
  (`1/2` + a small bar). A parent can never lie about being complete.
- **Manual override:** you can still close a milestone with loose ends. `[tt-override:: done]` records
  that choice *visibly*, so three weeks later you remember you closed it on purpose — and an agent can
  see it too.
- **Two gestures, kept apart.** Dragging a card between **Kanban columns** changes only that node's
  state (children don't travel). Dragging a node in the **tree** restructures it (the whole branch
  travels). See [`docs/03_FORMAT_SPEC.md`](docs/03_FORMAT_SPEC.md).
- **Dependencies across the tree.** `[tt-blocked-by:: t-aa10]` connects a task to the tasks it waits
  on — anywhere on the board, not just its siblings. Right-click → "Blocked by…" to wire one; a badge
  shows what's held, the dashboard lists everything "waiting on dependencies", and the diagram layout
  draws the edges as dashed curves. Dependencies are a *signal*: they never change a parent's derived
  state, so roll-up stays honest.

---

## A project dashboard, not just a view

Drop a board in a project folder and it becomes the project's command center — for you *and* for an
AI agent you point at the folder (see below). From one place you can **rename the board, add, delete,
rename, and tag tasks** (right-click a task, or double-click to rename; "Add task" in the header).

It's also built to surface the thing that quietly derails projects: **you think a milestone is done,
then a deep subtask blocks it.** Instead of getting ambushed, you get:

- a **summary bar** (counts per column + % done) so you read project health at a glance;
- a **Blockers & next-up panel** listing the blocked leaf tasks — each with the path up to the
  milestone it's holding back — plus the tasks you can actually pick up now;
- **⚠ blocked-path highlighting** so every ancestor of a blocked task lights up, and the chain from a
  milestone down to its hidden blocker is visible.

Open it with **"Open current file as dashboard"** (or the ribbon icon).

### Three tree layouts + full focus

The **tree** view can be drawn three ways (toolbar switch, remembered per board): **List** (vertical),
**Diagram** (a horizontal tree — the goal on the left, atomic blockers on the right, so completion
visibly flows right→left), and **Columns** (drill down level by level, Finder-style). A **focus
button** on any task opens it and its subtree in a distraction-free full-width pane, with a breadcrumb
to step back out.

---

## Quickstart

1. Install (see **Install** below) and enable **Task Tree** in Obsidian.
2. Open any note and run the command **“Task Tree: Convert current file to a Task Tree board”**
   (or click the ribbon icon — it converts the current note if needed).
3. Run **“Open current file as dashboard”** (stats + blockers + tree), or open it as a **Kanban board**
   or **tree**. Drag cards, expand branches, toggle checkboxes, switch tree layout, add/rename/tag
   tasks — every change writes straight back to the Markdown.

Columns are fully configurable in **Settings → Task Tree** (add/remove/rename; each maps to a
checkbox character). Defaults: **To Do** `[ ]`, **Doing** `[/]`, **Done** `[x]` — the universal
Obsidian/Tasks convention.

### Commands

- Open current file as dashboard
- Open current file as Kanban board
- Open current file as tree
- Create a new board
- Convert current file to a board
- Assign block IDs to all tasks in current file
- Open a board… (picker)
- Build the boards index (`index.md`)
- Append an entry to the boards log (`log.md`)

---

## Works with your AI assistant (a property, not a moat)

Because the format is clean, hierarchical Markdown, any agent can already read it — and Task Tree's
job is simply *not to break that*. The convention deliberately follows the methodology of Google
Cloud's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog) (OKF): a
board is an OKF *concept* (frontmatter + body), a vault of boards is an OKF *bundle*, and parent state
is deterministically recomputable from the leaves — so an agent only ever needs to read and write the
leaves. Details in [`docs/04_OKF_AND_AGENTS.md`](docs/04_OKF_AND_AGENTS.md).

Task Tree ships that promise as working material, not prose:

- **[`AGENTS.md`](AGENTS.md)** — the operating contract an agent follows to work a board *with* you:
  the opt-in gate, the grammar, roll-up it can recompute itself, the invariants it must never break,
  and the division of labor (you own intent and structure; it works the leaves and reports in tasks).
- **[`docs/agent/CONTRACT.md`](docs/agent/CONTRACT.md)** — the machine-readable version: regexes,
  role tables, reserved fields. Its examples are parsed by the real parser in CI, so it cannot drift.
- **[`skills/task-tree/`](skills/task-tree/)** — an installable skill for Claude Code (copy to
  `~/.claude/skills/task-tree/`) with ready recipes: survey every board in a vault, report status,
  "what's blocked and why", decompose a goal into subtasks, mark work done and explain what rolled up,
  build a board from existing project docs.

If you keep a project's documentation as Markdown in Obsidian, this turns the same files into a task
surface both you and your assistant can operate — no export, no sync, no second source of truth.

---

## Install

**Via BRAT (recommended until the community listing is live):** install the
[BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin, run its command
**"Add a beta plugin"**, and paste `Aldorithm392/obsidian-task-tree`. BRAT installs the latest
release and keeps it updated.

**Manual:** download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/Aldorithm392/obsidian-task-tree/releases/latest) into
`<your-vault>/.obsidian/plugins/task-tree/`, then enable **Task Tree** in
**Settings → Community plugins**.

**Build from source:**

```bash
npm install
npm run build      # typecheck + bundle → main.js
npm test           # run the core-logic test suite (no Obsidian needed)
```

For a live dev loop, `npm run dev` (esbuild watch) plus the
[hot-reload plugin](https://github.com/pjeby/hot-reload) in a test vault. Full setup in
[`docs/02_SETUP_AND_DEVELOPMENT.md`](docs/02_SETUP_AND_DEVELOPMENT.md).

**Publishing to the community directory:** tag a release `X.Y.Z` (no leading `v`) — the GitHub
Action in `.github/workflows/release.yml` builds and attaches `main.js`/`manifest.json`/`styles.css`
— then submit the repo to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases).
Checklist in [`docs/dev/OBSIDIAN_PLUGIN_REFERENCE.md`](docs/dev/OBSIDIAN_PLUGIN_REFERENCE.md).

---

## Documentation

The [`docs/`](docs/) folder is also an Obsidian vault you can open on its own.

- [`PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md) — mental model, glossary, checklist
- [`01_PLANNING.md`](docs/01_PLANNING.md) — the idea, the three axes, the stack
- [`02_SETUP_AND_DEVELOPMENT.md`](docs/02_SETUP_AND_DEVELOPMENT.md) — building and hacking on it
- [`03_FORMAT_SPEC.md`](docs/03_FORMAT_SPEC.md) — **the normative Markdown convention** (the core artifact)
- [`04_OKF_AND_AGENTS.md`](docs/04_OKF_AND_AGENTS.md) — OKF bundle + agent legibility
- [`examples/`](examples/) — a real board you can open, and a parser fixture

See also [`ROADMAP.md`](ROADMAP.md).

## License

[MIT](LICENSE).
