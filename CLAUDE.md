# CLAUDE.md — Task Tree working memory

Read this first. It's the project's working memory: what this is, how it's built, and the conventions
to keep. Keep it focused and current.

> This file is for **developing the plugin**. To *operate a user's boards* as an agent, read
> [AGENTS.md](AGENTS.md) (the operating contract) and
> [docs/agent/CONTRACT.md](docs/agent/CONTRACT.md) (machine-readable grammar, conformance-tested).

## What this is

**Task Tree** is an Obsidian community plugin that renders nested Markdown checklist tasks as **both a
collapsible tree and a Kanban board**, with parent state **derived from children (roll-up)**. Markdown
is the single source of truth; the plugin is a visualization + write-back layer. It is intentionally
compatible with AI agents by following the methodology of Google's Open Knowledge Format (OKF).

## The format (full spec: `docs/03_FORMAT_SPEC.md`) — do not break these

- **Opt-in gate:** the plugin manages a file *only* if its frontmatter has `type: task-tree`. Never
  read/write any other file.
- **Roles are the stable layer:** `todo | doing | done | cancelled | blocked`. Columns (name + one
  status char each) map to roles; roll-up and overrides reason about roles, not raw chars.
- **Task line:** `<indent>- [<status>] <text> [tt-override:: <role>]? [tt-blocked-by:: <ids>]? ^<id>?`.
  Indent = one **tab** per level by default. Block id `^t-<6 base36>` is the last token; existing ids
  are never regenerated.
- **Dependencies:** `[tt-blocked-by:: t-a1, t-b2]` — bare block ids, same board. A `done`/`cancelled`
  target releases the edge. **Separate signal: never feeds roll-up** (`resolveEdges` in
  `insights.ts` sets `isDependencyBlocked`; `computeRollup` never sees edges).
- **Roll-up:** post-order; override wins; leaf uses its own char; else `done` iff all non-cancelled
  children done, `blocked` if any child blocked, `doing` if any started, else `todo`. Progress `K/D`
  is rendered, never stored. Children win over a parent's char.
- **Override:** inline field `[tt-override:: <role>]`, visible on the line, before the `^id`.
- **Operation A (restructure)** moves a subtree (children travel; only indent/order change).
  **Operation B (state change)** flips exactly one status char. Keep them distinct.
- **Frontmatter is user-useful only** — no `okf_version` / `tt_version` stamped into board files.

## Architecture

```
src/
  main.ts              plugin: views, commands, ribbon, settings, activateView
  settings.ts          TaskTreeSettings + DEFAULT_SETTINGS + settings tab; getIndentUnit()
  columns.ts           char <-> column <-> role mapping; validateColumns()
  board-controller.ts  loadBoard(), ensureIds(), writeStatus/Override/moveNode (vault.process)
  model/               PURE, no 'obsidian' import (unit-tested under Node):
    types.ts           Role, TreeLayout, ColumnDef, RawListItem, ParsedLine, TaskNode, RollupOptions
    line.ts            parseLine()
    parser.ts          buildTree() from listItems + raw lines; flatten(); findById()
    rollup.ts          computeRollup()
    insights.ts        computeSummary / collectBlockers / collectNextUp / markBlockedPaths (dashboard)
                       + resolveEdges / collectDependencyBlocked (tt-blocked-by graph, cycles)
    writer.ts          setStatus/Override/BlockedBy, assignIds, moveSubtree + CRUD: insert/delete/setText/addTag
    ids.ts             generateId() / collectBlockIds()
    okf.ts             isManagedFrontmatter(), columnsFromFrontmatter(), index/log builders
  views/
    base-view.ts       TaskTreeView base + VIEW_TYPE_* (kanban/tree/dashboard); dashboard header + blockers panel
    kanban-view.ts     columns from model; SortableJS per column = Operation B; CRUD menu
    tree-view.ts       3 layouts (list/diagram/columns), collapse/focus, full-focus, checkbox toggle (opt-in column cycle), reparent = Operation A
    dashboard-view.ts  extends TreeView: full header + blockers panel + tree
    card.ts            shared chip / progress / override-badge DOM
    modals.ts          promptText() / confirmModal()
```

**Dashboard + editing:** views carry a compact dashboard header (rename board / add task / stats);
`DashboardView` adds the full Blockers & next-up panel. Editing (add/delete/rename/tag) goes through
`board-controller` CRUD wrappers → pure `writer` ops. `markBlockedPaths` runs in `loadBoard`, so every
view can show ⚠ on ancestors of a blocked leaf. Tree layout + focus state persist in the leaf view-state.

**Golden rule:** everything in `src/model/**` stays pure (no `obsidian` import) and written in
**erasable** TypeScript (no enums, no parameter properties) — that is what lets `tests/run.mjs` run it
under Node's native type-stripping with zero deps. The Obsidian API lives only in `main.ts`,
`settings.ts`, `board-controller.ts`, and `views/**`.

## Data flow

command/ribbon binds a `type: task-tree` file (persisted in the leaf view-state) → `loadBoard`
(`cachedRead` + `getFileCache().listItems`) → `buildTree` → `computeRollup` → both views project the
same model → gesture → one `vault.process` write → `metadataCache 'changed'` → debounced re-render
from fresh cache. Tasks are keyed by block id; status flips are length-preserving (no line shift);
one structural edit per `process()`.

## Commands

```bash
npm install
npm run build     # tsc -noEmit (typecheck) + esbuild → main.js
npm run dev       # esbuild watch (pair with pjeby/hot-reload in a test vault)
npm test          # node tests/run.mjs — pure-logic suite, no Obsidian, no deps
```

Release: `npm version patch|minor|major` (bumps manifest + versions.json), push tag `X.Y.Z`
(no leading `v`) → the GitHub Action attaches `main.js`/`manifest.json`/`styles.css`.

## Conventions & gotchas

- DOM via `createEl`/`createDiv`/`createSpan` only — never `innerHTML` (Obsidian review requirement).
- Do **not** `detachLeavesOfType` in `onunload` (disrupts user layout).
- Dynamic values (progress width, chip color) may use inline `style.setProperty`; everything else is
  a CSS class in `styles.css` using Obsidian CSS variables.
- Obsidian is a GUI — the views can't be run here. Verify pure logic with `npm test`; verify the UI by
  loading into a real vault. The `examples/` bundle doubles as a parser fixture.
- `tsconfig` uses `verbatimModuleSyntax` + `erasableSyntaxOnly` + `allowImportingTsExtensions`: use
  `import type` for type-only imports and `.ts` extensions on relative imports.
