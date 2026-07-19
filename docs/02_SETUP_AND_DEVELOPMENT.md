# ⚙️ Phases 2 & 3 · Setup and Development

> ↩︎ Back to the [Project Guide](PROJECT_GUIDE.md)

---

# Phase 2 · Setup

## Prerequisites
- Node ≥ 18 (this repo was built on Node 25) and npm.
- A throwaway Obsidian vault for testing.

## Install & build

```bash
npm install
npm run build     # tsc -noEmit (typecheck) + esbuild → main.js
npm test          # node tests/run.mjs — pure-logic suite (no Obsidian, no deps)
```

`npm run build` produces `main.js`. The three files Obsidian actually loads are `main.js`,
`manifest.json`, `styles.css`.

## Live dev loop
1. `npm run dev` — esbuild watch; rebuilds `main.js` on save.
2. Symlink (or point esbuild's output) into `<test-vault>/.obsidian/plugins/task-tree/`.
3. Install [pjeby/hot-reload](https://github.com/pjeby/hot-reload) and drop an empty `.hotreload`
   file in the plugin folder — it disables/re-enables the plugin when `main.js` changes.
4. Enable **Task Tree** in the vault's community-plugins settings.

## Repo `CLAUDE.md`
The project's working memory lives at [`../CLAUDE.md`](../CLAUDE.md): the format rules, the module
map, the data flow, and the conventions. Keep it current — it's what an agent (or future you) reads
to pick the project back up.

---

# Phase 3 · Development

## The cycle: Research → Plan → Implement → Test

- **Research** — the Obsidian API facts you need are captured in
  [`dev/OBSIDIAN_PLUGIN_REFERENCE.md`](dev/OBSIDIAN_PLUGIN_REFERENCE.md); the format contract is
  [`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md).
- **Plan** — for anything touching the format or write-back, sketch the change against the spec first.
- **Implement** — keep `src/model/**` pure; put Obsidian calls only in the view/controller layer.
- **Test** — add a case to `tests/run.mjs` for any parser/roll-up/writer change, then `npm test`.
  UI changes are verified by loading into a real vault (Obsidian is a GUI; it can't run headless here).

## Where things live

| You want to change… | Edit |
|----------------------|------|
| How tasks are parsed into a tree | `src/model/parser.ts` (+ `line.ts`) |
| Roll-up / progress / override resolution | `src/model/rollup.ts` |
| The exact text written on an edit | `src/model/writer.ts` |
| Block-id scheme | `src/model/ids.ts` |
| Columns ↔ status ↔ role mapping | `src/columns.ts` |
| Reading/writing frontmatter, the opt-in gate | `src/model/okf.ts`, `src/board-controller.ts` |
| Kanban look & drag behavior | `src/views/kanban-view.ts`, `styles.css` |
| Tree look, collapse/focus, reparent | `src/views/tree-view.ts`, `styles.css` |
| Settings (columns editor, toggles) | `src/settings.ts` |
| Commands, ribbon, view registration | `src/main.ts` |

## Testing philosophy
The load-bearing, dangerous code (turning gestures into text edits) is **pure and unit-tested**:
`setStatus`, `moveSubtree` re-indent across tab/2-space/4-space, `assignIds` (skips frontmatter),
roll-up edge cases, id collisions. This is why write-back can be trusted without a live Obsidian.

---

# Releasing

1. `npm version patch|minor|major` — bumps `manifest.json` + `versions.json` (via `version-bump.mjs`)
   and stages them. Commit.
2. `git tag X.Y.Z && git push origin X.Y.Z` (tag = bare version, **no** leading `v`).
3. The GitHub Action (`.github/workflows/release.yml`) builds and creates a **draft** release with
   `main.js`, `manifest.json`, `styles.css` attached individually. Edit notes and publish.
4. First-time submission: add an entry to `community-plugins.json` in
   [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) and open a PR.
   The full checklist is in [`dev/OBSIDIAN_PLUGIN_REFERENCE.md`](dev/OBSIDIAN_PLUGIN_REFERENCE.md).
