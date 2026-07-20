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

## Next

- [ ] Manual QA pass in a real vault; polish drag affordances and empty states.
- [ ] Persist collapse/focus state per board across reloads.
- [ ] Render card/​node text as Markdown (links, tags) via `MarkdownRenderer`.
- [ ] `index.md` / `log.md` bundle commands (helpers already exist in `okf.ts`).
- [ ] Per-column colors and WIP-limit surfacing in the UI (data model already supports them).
- [ ] Optional ESLint + `eslint-plugin-obsidianmd` for stricter review compliance.

## On the horizon (from the design doc)

- **Provenance metadata** — an optional, lightweight note like "completed by an agent on 2026-07-19"
  for human–agent workflows. Explicitly *not* in the MVP, but a natural OKF-friendly extension
  (a `tt-`-namespaced inline field or a frontmatter map keyed by block id).
- **Cross-file task moves** — moving a subtree between boards, reassigning ids only on collision.
- **Large-board performance** — DOM virtualization past a few hundred visible cards.

## Open tuning questions (defaults chosen; all reversible)

- Unknown status char → `doing` (current) vs. escalate to `blocked` (louder)?
- Should `blocked` always dominate a partially-done parent? (currently yes, toggleable)
- One board per file (current) vs. multiple boards per file?
- "Stamp `tt_columns` into every managed file for max portability" — currently **off**.
