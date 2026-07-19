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
> on the task. Task Tree writes only three things to a task line — its status character, its `^id`,
> and (on override) that marker — and leaves everything else verbatim.

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

---

## Quickstart

1. Install (see **Install** below) and enable **Task Tree** in Obsidian.
2. Open any note and run the command **“Task Tree: Convert current file to a Task Tree board”**
   (or click the ribbon icon — it converts the current note if needed).
3. Run **“Open current file as Kanban board”** or **“…as tree.”** Drag cards, expand branches,
   toggle checkboxes — every change writes straight back to the Markdown.

Columns are fully configurable in **Settings → Task Tree** (add/remove/rename; each maps to a
checkbox character). Defaults: **To Do** `[ ]`, **Doing** `[/]`, **Done** `[x]` — the universal
Obsidian/Tasks convention.

### Commands

- Open current file as Kanban board
- Open current file as tree
- Convert current file to a Task Tree board
- Assign block IDs to all tasks in current file
- Open a Task Tree board… (picker)

---

## Works nicely with AI agents (a property, not a moat)

Because the format is clean, hierarchical Markdown, any agent can already read it — and Task Tree's
job is simply *not to break that*. The convention deliberately follows the methodology of Google
Cloud's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog) (OKF): a
board is an OKF *concept* (frontmatter + body), a vault of boards is an OKF *bundle*, and parent state
is deterministically recomputable from the leaves — so an agent only ever needs to read and write the
leaves. Details in [`docs/04_OKF_AND_AGENTS.md`](docs/04_OKF_AND_AGENTS.md).

---

## Install

**From this repo (manual):** copy `main.js`, `manifest.json`, and `styles.css` into
`<your-vault>/.obsidian/plugins/task-tree/`, then enable it in **Settings → Community plugins**.

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
