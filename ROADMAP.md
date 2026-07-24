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

## Next (path to 1.0)

**Now — finish "the plugin owns the files"**
- [ ] YAML `title` = note title: renaming the board renames the file (links rewritten via
  `fileManager.renameFile`).

**Polish — ship-quality views**
- [ ] Render card/node text as Markdown (links, tags) via `MarkdownRenderer` — task-note `[[links]]`
  must render as links, not raw brackets.
- [ ] Persist collapse state per board across reloads (stable `^ids` only).
- [ ] Per-column colors and WIP-limit inputs in settings (Kanban already renders both).
- [ ] `index.md` / `log.md` bundle commands (helpers already exist in `okf.ts`).

**The graph — connect tasks to each other**
- [ ] `tt-blocked-by` inline field: same-board dependencies by block id; cycle + unresolved-id
  detection; dependency badge in every view; dashed dependency edges in the diagram layout.
  Dependency-blocked is a *separate signal* — it never feeds roll-up, so a parent's state stays
  recomputable from its own leaves.

**Agent-ready, for real**
- [ ] `AGENTS.md` operating contract at the repo root: the gate, the grammar, roll-up semantics,
  Operation A vs B, the invariants an agent must never break, and the human/AI division of labor.
- [ ] `docs/agent/CONTRACT.md` — machine-readable tables (line grammar, roles, reserved `tt-` fields,
  frontmatter keys), conformance-tested against `src/model/line.ts`.
- [ ] An installable Claude Code skill (`skills/task-tree/`) with recipes for operating boards in a
  documentation vault.

**Ship 1.0**
- [ ] ESLint + `eslint-plugin-obsidianmd`; compliance sweep (`normalizePath`, sentence case, no `any`).
- [ ] Manual QA in a real vault (`docs/dev/QA_CHECKLIST.md`); mobile-width check.
- [ ] Tag `1.0.0`; submit to the community plugin directory; README install + agent sections.

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
