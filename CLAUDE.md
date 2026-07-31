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
- **Columns are a layout, not a vocabulary.** `DEFAULT_COLUMNS` ships four lanes (no `cancelled` —
  it isn't a stage in the flow), but **menus offer every role** via `boardLanes(columns, ALL_ROLES)`.
  Iterating `model.columns` in a menu is the bug that made "Mark as Cancelled" not exist on a default
  board. A role with tasks and no column earns a lane on that board only — otherwise those cards fell
  through to `columns[0]`, and cancelled work reappeared at the top of To Do.
- **Task line:** `<indent>- [<status>] <text> [tt-override:: <role>]? [tt-blocked-by:: <ids>]? ^<id>?`.
  Indent = one **tab** per level by default. Block id `^t-<6 base36>` is the last token; existing ids
  are never regenerated.
- **Dependencies:** `[tt-blocked-by:: t-a1, t-b2]` — bare block ids, same board. A `done`/`cancelled`
  target releases the edge. **Separate signal: never feeds roll-up** (`resolveEdges` in
  `insights.ts` sets `isDependencyBlocked`; `computeRollup` never sees edges).
- **Note progress:** checklists inside a task's `type: task-note` note, followed recursively through
  the task-notes *it* links to. The **second separate signal**: read-only, cache-only, gated on
  `type: task-note`, and `computeRollup` never sees it either. `walkNoteProgress` is pure; the vault
  adapter (`attachNoteProgress` / `readNoteSnapshot`) lives in `board-controller.ts`.
- **Roll-up:** post-order; override wins; leaf uses its own char; else `done` iff all non-cancelled
  children done, `blocked` if any child blocked, `doing` if any started, else `todo`. Progress `K/D`
  is rendered, never stored. Children win over a parent's char.
- **Override:** inline field `[tt-override:: <role>]`, visible on the line, before the `^id`.
- **Operation A (restructure)** moves a subtree (children travel; only indent/order change).
  **Operation B (state change)** flips exactly one status char. Keep them distinct.
- **Frontmatter is user-useful only** — no `okf_version` / `tt_version` stamped into board files.
- **The membrane, both ways.** Meaning that a reader needs goes IN the file: `tt_columns` is stamped
  once when a board's char→role mapping deviates from the *published* table (`ensureBoardColumns`),
  because comparing a board to the reader's own settings is circular. Derivations stay OUT of files
  the plugin doesn't own: task-notes carry `title`/`board`/`parent`/`task_id` only — `depth`,
  `distance_to_main` and `path` were removed and are stripped on reconcile.

## Architecture

```
src/
  main.ts              plugin: views, commands, ribbon, settings, activateView, leaf-rebind on rename,
                       maybeOfferAgentSetup (consent-once agent onboarding)
  settings.ts          TaskTreeSettings + DEFAULT_SETTINGS + settings tab; FROZEN (decisions the
                       plugin makes so the user needn't); getIndentUnit()
  columns.ts           char <-> column <-> role mapping; validateColumns(); boardLanes() — the
                       lanes a board draws / the roles a menu offers (columns are a LAYOUT)
  board-controller.ts  loadBoard() (+ debounced note reconcile), ensureIds(), writeStatus/Override/
                       BlockedBy/moveNode (vault.process), task=note create/resolve, reconcileBoardNotes
  agent-setup.ts       maintains vault AGENTS.md managed section + .claude/skills/task-tree
                       (CONTRACT.md + SKILL.md bundled as text via esbuild loader)
  model/               PURE, no 'obsidian' import (unit-tested under Node):
    types.ts           Role, TreeLayout, ColumnDef, RawListItem, ParsedLine, TaskNode, RollupOptions
    line.ts            parseLine()
    parser.ts          buildTree() from listItems + raw lines; flatten(); findById()
    rollup.ts          computeRollup()
    insights.ts        computeSummary / collectBlockers / collectNextUp / markBlockedPaths (dashboard)
                       + resolveEdges / collectDependencyBlocked (tt-blocked-by graph, cycles)
    folding.ts         isFolded() / visibleNodes() — the tri-state fold rule (explicit collapse >
                       explicit expand > depth default), so the off-by-one is a test not a surprise
    notemeta.ts        expectedNoteFields / noteFieldsDrift / retiredFieldsPresent — single source
                       of truth for task-note frontmatter (creation + reconcile build from it)
    noteprogress.ts    walkNoteProgress() — recursive checklist counts across linked task-notes
                       (caller supplies the reader; visited-set + depth cap + note budget)
    fuzzy.ts           foldDiacritics() / displayForm() — length-preserving accent folding
    templates.ts       parse/renderStarterTasks + parse/renderNoteSections (generated text = settings)
    writer.ts          setStatus/Override/BlockedBy, assignIds, moveSubtree + CRUD: insert/delete/setText/addTag
    ids.ts             generateId() / collectBlockIds()
    okf.ts             isManagedFrontmatter(), isTaskNoteFrontmatter(), columnsFromFrontmatter()
  views/
    base-view.ts       TaskTreeView base + VIEW_TYPE_* (kanban/tree/dashboard); dashboard header + blockers panel
    kanban-view.ts     columns from model; SortableJS per column = Operation B; CRUD menu
    tree-view.ts       2 layouts (list/diagram) sharing ONE fold state, focus-on-branch, derived
                       checkbox = readout, keyboard layer, localRect() geometry, reparent = Op A
    dashboard-view.ts  extends TreeView: full header + blockers panel + tree
    card.ts            shared chip / progress / note-progress / override-badge DOM + roleIcon()
    modals.ts          promptText() / confirmModal() -> confirm|reject|dismiss / confirmed() /
                       AccentFuzzyModal (accent-insensitive pickers)
```

**Dashboard + editing:** views carry a compact dashboard header (rename board / add task / stats);
`DashboardView` adds the full Blockers & next-up panel. Editing (add/delete/rename/tag) goes through
`board-controller` CRUD wrappers → pure `writer` ops. `markBlockedPaths` runs in `loadBoard`, so every
view can show ⚠ on ancestors of a blocked leaf. Tree layout + fold + focus state persist in the leaf
view-state.

**One hiding gesture.** A board opens `FROZEN.openDepth` levels deep; a chevron records an explicit
decision that outranks the default forever, in either direction — hence `collapsed` *and* `expanded`.
Both layouts read `isCollapsed()`, never the sets: reading `collapsed.has(id)` directly is how the
diagram once drew an open branch under a chevron pointing right, and a test now fails on it. Depth
counts from the **view root** (`FoldState.baseDepth`), not the board root — otherwise focusing a deep
branch hides the very subtree you asked to see.

**Keyboard:** every layout is walkable on a roving tabindex (`wireTreeKeyboard` in
`tree-view.ts`; the list is also a real ARIA tree): ↑↓ walk, ←→ fold, Enter edits, Space toggles. Anything that writes re-renders, so
the row to land on afterwards is stashed in `pendingFocusId` and re-focused on the way back — the
same trick `pendingEdit` uses in `base-view.ts`.

**Generated text is a setting, not a literal.** Starter tasks and task-note headings come from
`newBoardStarterTasks` / `taskNoteSections` via `model/templates.ts`. When adding anything the plugin
*writes into a user's vault*, put it behind a setting rather than hard-coding English.

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

**Settings are a last resort.** A setting is not a reversible decision — it is a permanent branch in
the code, in `docs/03_FORMAT_SPEC.md`, in `docs/agent/CONTRACT.md`, in the skill installed inside
users' vaults, and in `docs/dev/QA_CHECKLIST.md`. Before adding one, ask whether it encodes a genuine
disagreement between two reasonable users (where my files live) or a decision the plugin declined to
make (what an unmapped character means). The second kind belongs in `FROZEN` in `settings.ts`.

Release: `npm version patch|minor|major` (bumps manifest + versions.json), push tag `X.Y.Z`
(no leading `v`) → the GitHub Action attaches `main.js`/`manifest.json`/`styles.css`.

## Conventions & gotchas

- DOM via `createEl`/`createDiv`/`createSpan` only — never `innerHTML` (Obsidian review requirement).
- Do **not** `detachLeavesOfType` in `onunload` (disrupts user layout).
- Dynamic values (progress width, chip color) may use inline `style.setProperty`; everything else is
  a CSS class in `styles.css` using Obsidian CSS variables.
- **Spacing is tokens, not literals.** Every gap/padding in the tree views comes from a custom
  property on `.tt-view` (`--tt-connector`, `--tt-row-gap`, `--tt-indent`, …); `.tt-view.is-compact`
  retunes the whole view in one block. Add a token rather than a hard-coded px in a rule.
- **Overlay geometry uses the offset chain, never `getBoundingClientRect`.** The inverted diagram
  wraps the canvas in `transform: scaleX(-1)` and the SVG overlays live inside it, so screen
  coordinates come back mirrored. `localRect()` in `tree-view.ts` is the one way to measure.
- Obsidian is a GUI — the views can't be run here. Verify pure logic with `npm test`; verify *layout*
  with `tools/visual/` (real DOM + real stylesheet, screenshotted in headless Chromium — see
  `docs/dev/VISUAL_HARNESS.md`); verify behaviour by loading into a real vault. The `examples/`
  bundle doubles as a parser fixture.
- `tsconfig` uses `verbatimModuleSyntax` + `erasableSyntaxOnly` + `allowImportingTsExtensions`: use
  `import type` for type-only imports and `.ts` extensions on relative imports.
