# Roadmap

## Format version

The Task Tree format is at **v0.1**. Following the user decision that *frontmatter should carry only
user-useful data*, the plugin does **not** stamp format/spec version markers (`okf_version`,
`tt_version`) into board files — those are documentation concerns, kept here and in
[`docs/03_FORMAT_SPEC.md`](docs/03_FORMAT_SPEC.md). If a future format change ever needs per-file
migration, a `tt_version` key can be introduced then, opt-in.

## Shipped (v0.1 — MVP)

- Opt-in gate (`type: task-tree`), OKF-aligned board files.
- Pure, unit-tested core: parser, roll-up (+ edge cases), writer (status / override / move / ids), ids.
- Kanban view — drag between columns = change state (Operation B); progress + override badges.
- Tree view — collapse/expand, focus-by-branch, checkbox cycle, reparent/indent/outdent (Operation A).
- Configurable columns (name + status char + role), indentation, block-id scheme, roll-up options.
- Auto-assign block ids to every task in a managed board.
- Release workflow + publishing docs.

## Shipped (v0.2 — dashboard, layouts, editing)

- **Dashboard view** + a compact dashboard header on the Kanban/Tree views: rename board, add tasks,
  per-column counts, % done.
- **Task editing from the UI:** add (child / sibling / root), delete (confirm for subtrees), inline
  rename (double-click), and tag — via context menu.
- **Attack the "hidden deep blocker" pain:** a Blockers & next-up panel, ⚠ blocked-path highlighting on
  ancestors, and summary stats (`src/model/insights.ts`, unit-tested).
- **Three tree layouts** — list, diagram (horizontal tree + CSS connectors), columns (Finder-style
  drill-down); remembered per board via view state.
- **Full-focus view** — open any task + its subtree distraction-free in a main-area pane.

## Shipped (v0.3 — human-first)

- **Clean default view:** opening a board shows just the tree/board; stats + dashboard are opt-in
  (ribbon opens the plain tree, `showBoardStats` off by default).
- **Inline + / − on every node, in every view** (list / diagram / columns / kanban): hover a node to
  add a nested subtask or delete it — full editing without ever opening the raw note.
- **Three-layer model made explicit:** the Markdown note is the shared structure; the plugin is the
  human editing/visualization layer; an LLM reads the raw file. Dogfooded via `examples/plugin-development.md`.

## Shipped (v0.4 — the reset: edit everything from the view)

- **Inline text editing in every view** (list / diagram / columns / kanban) — click a task and write on
  it; Enter saves, Esc cancels; never jump to the raw file.
- **"New board from zero"** command + a default-folder setting; the human never touches files.
- **Task = note:** open any task as its own linked note (`[[link]]`) for progress / status / code, in
  the configured folder.
- **Self-describing task-notes (OKF concept):** frontmatter carries `type`, `parent`, `depth`, `path`,
  `distance_to_main` — an agent reads a task-note standalone; frontmatter auto-resyncs on move.
- **Inverted tree** — a direction toggle on the diagram and columns layouts, so *enabling* tasks flow
  into the final project (goal at the apex). Same Markdown, another lens.
- **Drag-reparent everywhere** + "Nest under…" and deterministic Move up/down / Indent / Outdent.
- `author` / GitHub handle filled in `manifest.json`.

## Shipped (v1.0 — released 2026-07-24, submitted to the community directory)

- **The plugin owns the files:** renaming a board renames the file, inbound `[[links]]` rewritten.
- **Ship-quality views:** Markdown-rendered task text (fast plain-text path), persisted collapse
  state, per-column colors + WIP-limit inputs, `index.md` / `log.md` commands.
- **Capture flow:** every add drops straight into inline edit; Enter chains the next sibling;
  abandoned placeholders remove themselves.
- **The graph:** `tt-blocked-by` same-board dependencies — cycle + unresolved-id detection,
  badges in every view, "Waiting on dependencies" panel, dashed edges in the diagram. A *separate
  signal*: never feeds roll-up.
- **YAML integrity:** task-note frontmatter reconciles on every render, cause-agnostically (plugin,
  agent, or hand edits); deleted tasks mark notes `task_status: orphaned` (undo clears); "Resync all
  task-note frontmatter" command.
- **Agent-ready, embedded:** `AGENTS.md` contract + conformance-tested `docs/agent/CONTRACT.md` +
  `skills/task-tree/` — all bundled into `main.js`; one-time consent lets the plugin maintain the
  instructions and skill *inside the user's vault*, forever.
- **Release engineering:** ESLint + `eslint-plugin-obsidianmd` (0 errors), CI, two live UX/CX QA
  rounds (`docs/dev/UX_QA_FINDINGS.md`), build-provenance attestations, release 1.0.0 published,
  directory submission live.

## Next after 1.0 (v1.1 — depth through notes)

- **Recursive task detection across linked notes.** A task's own note can carry its own checklists and
  links to deeper task-notes; the board detects and surfaces that pending work recursively (board task
  → its note's tasks → *their* linked notes → …). Read-only note-progress badges computed from the
  metadata cache; visited-set cycle guard; depth cap; opt-in frontmatter gate. A *separate signal* —
  never feeds roll-up — so each file's state stays recomputable from that file alone. The user sees the
  real depth of everything they do and documents each task as far as their project goes.

## On the horizon (from the design doc)

- **Provenance metadata** — an optional, lightweight note like "completed by an agent on 2026-07-19"
  for human–agent workflows. Explicitly *not* in the MVP, but a natural OKF-friendly extension
  (a `tt-`-namespaced inline field or a frontmatter map keyed by block id).
- **Cross-file task moves** — moving a subtree between boards, reassigning ids only on collision.
- **Large-board performance** — DOM virtualization past a few hundred visible cards.
- **`tt-rel`** — non-blocking task relations, once `tt-blocked-by` has proven the edge format.
- **Cross-file dependencies** — deferred together with cross-file moves.

## Open tuning questions (defaults chosen; all reversible)

- Unknown status char → `doing` (current) vs. escalate to `blocked` (louder)?
- Should `blocked` always dominate a partially-done parent? (currently yes, toggleable)
- Should a dependency-blocked task read as `blocked`, or stay a separate signal? (planned: separate)
- One board per file (current) vs. multiple boards per file?
- "Stamp `tt_columns` into every managed file for max portability" — currently **off**.
