# Obsidian plugin developer reference (for Task Tree)

A verified, condensed reference compiled while building Task Tree. Checked against the official
[sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin),
[`obsidian-api`](https://github.com/obsidianmd/obsidian-api) (`obsidian.d.ts`, verified locally at
v1.13.1), the [developer docs](https://docs.obsidian.md), and
[`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases).

---

## 1. Scaffolding & build

**Release artifacts = exactly three files:** `main.js`, `manifest.json`, `styles.css`. Source is not
shipped; `main.js` is git-ignored and only attached to a GitHub release.

**`manifest.json`** — required keys: `id`, `name`, `version`, `minAppVersion`, `description`,
`author`, `isDesktopOnly`. `id` is kebab-case, must not contain "obsidian" or end with "plugin", and
must match the community submission entry. `version` is bare semver (no `v`). Optional `authorUrl`,
`fundingUrl` (string or `{label: url}`).

**`versions.json`** — `{ "pluginVersion": "minAppVersion" }`. Lets an older app resolve the newest
plugin build whose `minAppVersion` it satisfies. `version-bump.mjs` (run by `npm version`) keeps it
and `manifest.json` in sync.

**`esbuild.config.mjs`** — `bundle: true`, `format: 'cjs'`, `target: 'es2021'`,
`external: ['obsidian','electron', ...@codemirror/*, ...@lezer/*, ...builtinModules]`, `outfile:
'main.js'`. `'obsidian'` is external because the host injects it at runtime; third-party libs (e.g.
SortableJS) are bundled in. Prod = single `rebuild()`; dev = `context.watch()`.

**`tsconfig.json`** — `module: ESNext`, `target: ES2021`, `strict`, `isolatedModules`,
`skipLibCheck`, `noUncheckedIndexedAccess`. (This project additionally uses `verbatimModuleSyntax`,
`erasableSyntaxOnly`, and `allowImportingTsExtensions` so the pure `src/model/**` can run under Node's
native TypeScript stripping for tests — see `../02_SETUP_AND_DEVELOPMENT.md`.)

**Dotfiles** — `.gitignore` ignores `node_modules`, `main.js`, `*.map`, `data.json`. `.npmrc` has
`tag-version-prefix=""` so `npm version` tags as bare `X.Y.Z`. `.editorconfig` sets tabs.

**Dev loop** — [`pjeby/hot-reload`](https://github.com/pjeby/hot-reload) + an empty `.hotreload` file
in the plugin folder reloads on `main.js` change; pair with `npm run dev`.

---

## 2. Plugin API you'll use

**Lifecycle:** `onload`/`onunload`; `addRibbonIcon(icon, title, cb)`; `addCommand({id, name,
callback | checkCallback | editorCallback})`; `addSettingTab`; `registerView(type, leaf => view)`;
`registerEvent`; `loadData`/`saveData`; `addChild`.

**Custom view — subclass `ItemView`:** `getViewType()`, `getDisplayText()`, `getIcon(): IconName`,
`onOpen()`, `onClose()`; build DOM in `this.contentEl`. Persist per-view state by overriding
`getState()` / `setState(state, result)`.

**Open a view (canonical):**
```ts
const leaves = workspace.getLeavesOfType(VIEW_TYPE);
let leaf = leaves[0] ?? null;
if (!leaf) { leaf = workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true, state }); }
workspace.revealLeaf(leaf);
```
Also `getLeftLeaf(false)` / `getRightLeaf(false)` for sidebars. **Do NOT** `detachLeavesOfType` in
`onunload` (it disrupts the user's saved layout).

**DOM:** `createEl/createDiv/createSpan(o?, cb?)` with `{cls, text, attr}`; `empty()`; global
`setIcon(el, iconId)` (Lucide ids) and `addIcon(id, svg)`. Never `innerHTML` (review requirement).

**Settings:** `PluginSettingTab.display()` + `new Setting(el).setName().setDesc().addText/addToggle/
addDropdown/addButton()`; `.setHeading()` for sections. Persist via `loadData`/`saveData` → `data.json`.

**Render Markdown in a view:** `MarkdownRenderer.render(app, md, el, sourcePath, component)`.

**Utilities:** `debounce(fn, ms, resetTimer)`; `Menu` (`.addItem().setTitle().setIcon().onClick()`,
`.showAtMouseEvent(e)`); `FuzzySuggestModal<T>` (`getItems`, `getItemText`, `onChooseItem`).

---

## 3. Reading & writing nested tasks

**`metadataCache.getFileCache(file): CachedMetadata`** → `listItems?: ListItemCache[]`, plus
`frontmatter`, `headings`, `blocks`. `ListItemCache`:
- `position: { start: {line,col,offset}, end: {...} }` (0-based lines)
- `task?: string` — the char in `[ ]`; `' '` = incomplete; **any other char** = a status;
  `undefined` = not a task
- `id?: string` — block id (no caret)
- `parent: number` — parent list item's `start.line` when `>= 0`; when `< 0` it's the negative of the
  list's first line (i.e. a root item). **Reconstruct** by attaching each item to the node whose line
  equals `parent`, treating `parent < 0` as a root. (Task Tree additionally requires the attach target
  to be earlier and less-indented, sidestepping the `-0` case when a list starts on line 0.)

**Read:** `vault.cachedRead(file)` (display) / `vault.read(file)` (before editing).
**Write (atomic):** `vault.process(file, data => newData)` — read-modify-write; prefer line edits
keyed by `position.start.line`. **Frontmatter:** `fileManager.processFrontMatter(file, fm => {...})`.

**React to changes:** `registerEvent(metadataCache.on('changed', (file, data, cache) => ...))` fires
after re-index — **including after your own write** — so guard feedback loops (content-hash / writing
flag) and `debounce` re-renders. Also `vault.on('rename'|'delete')`.

**Block ids:** append ` ^id` as the last token; ids are `[A-Za-z0-9-]`, unique per file.

---

## 4. Status conventions & Kanban format

**Tasks-plugin status types & default symbols:** `TODO ' '`, `IN_PROGRESS '/'`, `DONE 'x'`,
`CANCELLED '-'` (plus `ON_HOLD`, `NON_TASK`). Themes render the char via a **`data-task`** attribute
on the `<li>`/checkbox, styled with `[data-task="/"]`-type selectors. Community/theme symbols include
`?` `!` `>` `<` `*` `"` and many letters — casing matters and meanings collide across themes, which is
exactly why Task Tree lets the user map symbol → column → role rather than hardcoding.

**Do not emit** Tasks metadata emoji in task text (`📅 ⏳ 🛫 ✅ ❌ ➕ 🔁 🔺⏫🔼🔽⏬ 🆔 ⛔`) — Tasks parses them.

**obsidian-kanban board file** (for reference): frontmatter `kanban-plugin: basic`; lanes = `##`
headings; cards = `- [ ]`; a settings block `%% kanban:settings ```json … ``` %%`; archive after `***`
under `%% kanban:archive %%`. Task Tree does **not** use this format — it uses plain nested checklists
so files stay ordinary Markdown — but the lane-as-heading idea informed the column model.

---

## 5. Drag-and-drop & safe write-back

obsidian-kanban uses a hand-rolled Preact DnD engine — too heavy to copy. **Recommended for a new
plugin: [SortableJS](https://github.com/SortableJS/Sortable)** (~45 KB, framework-agnostic, bundled by
esbuild). `new Sortable(colEl, { group, animation, ghostClass, onEnd(evt) })` gives
`evt.item / evt.to / evt.from / evt.oldIndex / evt.newIndex`.

Patterns Task Tree follows:
- **Change-state drag (Operation B):** flip one status char with a length-preserving regex
  (`/^(\s*[-*+]\s+\[)[^\]]?(\])/`) inside `vault.process` — no line shifts.
- **Restructure (Operation A):** cut the contiguous `[start..lastDescendant]` range, re-indent by the
  depth delta, splice — one `vault.process`, then re-derive from a fresh cache (line numbers shifted).
- **Don't trust SortableJS's DOM mutation** — let the guarded re-render reconcile from the model.
- Sort disabled within Kanban columns because Markdown can't encode cross-parent vertical order.

---

## 6. Publishing checklist

1. `manifest.json` at repo root — valid bare-semver `version`, correct `minAppVersion`, clean `id`,
   accurate `isDesktopOnly`. `versions.json` has `"<version>": "<minAppVersion>"`.
2. GitHub release **tagged `X.Y.Z`** (no `v`), title = version, with `main.js` + `manifest.json`
   (+ `styles.css`) attached as **individual assets** (the source zip is not enough). The included
   `.github/workflows/release.yml` does this on tag push (needs Actions write permission).
3. `LICENSE` + `README` present.
4. No `innerHTML` / global `app` / hardcoded styles / console spam; commands in sentence case without
   the plugin-name prefix; resources registered for cleanup; no `detachLeavesOfType` in `onunload`.
5. Append an entry to `community-plugins.json` in
   [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
   (`id`, `name`, `author`, `description`, `repo` = `owner/name`) → open a PR → the validation bot runs
   (re-scans your repo within ~6 h after you push fixes; **don't** open a new PR) → a human merges.

**Sources:** docs.obsidian.md; github.com/obsidianmd/{obsidian-sample-plugin, obsidian-api,
obsidian-releases}; publish.obsidian.md/tasks; github.com/mgmeyers/obsidian-kanban;
github.com/SortableJS/Sortable.
