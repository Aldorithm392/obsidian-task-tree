# Manual QA checklist (run in a real vault before every release)

Setup: link the repo into `<vault>/.obsidian/plugins/task-tree`, `npm run dev`, enable the plugin
(+ hot-reload). Use the `examples/` bundle as the test corpus — it doubles as the parser fixture.

## Commands

- [ ] Ribbon "Open Task Tree" opens the tree on the active board.
- [ ] "Open current file as tree / Kanban board / dashboard" — each opens and binds the file.
- [ ] "Create a new board" — prompts, creates in the configured folder, opens the tree, starter
  tasks present. Empty folder setting → vault root; collision → " 2" suffix.
- [ ] "Convert current file to a board" — adds `type: task-tree` + `title` without touching the body.
- [ ] Block IDs are assigned automatically on first render — every task gets `^t-…` once, ids stable on re-open. There is no toggle and no command; that is deliberate.
- [ ] "Add a task to the open board" — works with the tree focused, with it parked in a sidebar,
  and with only the Kanban open; the new row lands in edit mode.
- [ ] "Open a board…" — lists only `type: task-tree` files; typing an unaccented query finds an
  accented board (`dia` → `día`) and the match highlight lands on the right characters.

## Views

- [ ] Tree list: collapse/expand; collapse survives an Obsidian restart (stable-id nodes).
- [ ] Tree diagram: hierarchy connectors; inverted toggle flips goal to the right; dependency
  overlay draws dashed curves (red = held); overlay toggle hides them; both persist.
- [ ] Tree columns: drill-down; inverted variant.
- [ ] Kanban: drag between columns flips exactly one status char (check the file diff!); WIP-exceeded
  column shows the over-limit style; column color tints header and chips. An empty column shows the
  dashed drop target, and it vanishes as soon as a card lands there.
- [ ] Context menus: "Mark as …" / "Move to …" show a distinct icon per role, not five checks.
- [ ] Dashboard: stats, Blockers, "Waiting on dependencies" (when edges are held), Next up.
- [ ] Full focus: open a subtree, edit inside it, exit.
- [ ] Markdown in task text renders (a `[[link]]`, `**bold**`, a `#tag`); clicking a link opens it;
  clicking plain text starts the inline edit.

## Editing (watch the file after every action — this is the real assertion)

- [ ] Inline rename (click / double-click by view): Enter saves, Esc cancels, blur saves; the line
  keeps its status, override, blocked-by, and `^id`.
- [ ] + / − hover buttons on nodes in every layout.
- [ ] Context menu: mark as each column (same wording in tree and Kanban), override set + clear, move up/down, indent/outdent,
  add subtask/sibling, rename, tag, delete (confirm on subtree).
- [ ] Drag-reparent (list grip, diagram, columns) — children travel; only indent/order changes.
- [ ] "Blocked by…" picker: adds `[tt-blocked-by:: …]` before `^id`; picking again removes; "Clear
  dependencies" removes the field; badge + overlay update.
- [ ] Rename board (header / goal box): frontmatter `title` set AND the file renamed; a `[[link]]`
  to the board from another note still resolves; the open view stays bound.

## Task = note

- [ ] "Open / create note": creates in the configured folder with self-describing frontmatter,
  appends the trailing `[[link]]`, opens in a new tab. Re-invoke → just opens.
- [ ] Move the task's subtree → the note's `parent` / `depth` / `path` frontmatter resyncs.
- [ ] Note sections match the "Task-note sections" setting; emptying it creates a note that is
  just frontmatter.

## Depth: recursive note progress

- [ ] Add `- [ ]` / `- [x]` items to a task's note → the board task shows a `K/N` badge; ticking an
  item in the note updates it, and **no board status character changes**.
- [ ] Link a second `type: task-note` from that note, give it checklists → the badge counts both;
  the dashboard lists the task under "Open inside linked notes".
- [ ] Set the depth to 1 → the badge drops the deeper counts and shows a trailing `+`.
- [ ] Link two notes to each other (a cycle) → the badge is finite and the view still renders.
- [ ] Link a note to a plain note that is NOT `type: task-note` → its checklists are ignored.
- [ ] Turn "Show note progress" off → every badge disappears; nothing else changes.

## Keyboard (all three layouts)

- [ ] Tab once into the tree, then ↑ ↓ walk rows with a visible focus ring (light **and** dark) —
  check the list **and** the diagram.
- [ ] → opens a collapsed branch and ← closes an open one, **keeping focus on the same row**;
  ← on a leaf jumps to its parent.
- [ ] Columns layout: → drills into the next pane and lands on its first item; ← steps back out.
- [ ] Enter opens the inline editor; Escape cancels it and Enter saves.
- [ ] Space toggles done without scrolling the pane, and focus stays put after the re-render.
- [ ] Alt+↑/↓ move the task, Alt+→/← indent and outdent — focus follows the **task**, not the slot.
- [ ] The menu key (or Shift+F10) opens the context menu anchored at the focused row.

## Density & layout

- [ ] Settings → Density → Compact tightens every layout and Comfortable restores it, with no
  reload needed (the dashboard updates too).
- [ ] Diagram: nodes read as cards on the dot-grid canvas; the in-flight card shows a coloured left
  edge and a blocked one shows red; hovering lifts the card.
- [ ] List: indent guides descend from each parent; top-level tasks read heavier than their leaves.
- [ ] **Inverted diagram + dependencies**: turn on the invert toggle with `tt-blocked-by` edges
  present — every dashed curve must terminate **on a task box**, not in empty space.
- [ ] Both densities survive a narrow pane without horizontal overflow of the page body.

## Safety (added after the 1.1.1 audit — these are the ones that cost data)

- [ ] Ribbon / "Open current file as …" on a note **without** `type: task-tree`: it must show the
  "not a board yet" screen and write **nothing** — check the file is untouched and no `^ids` appear.
- [ ] Same, on a note declaring `type: book`: an explanatory notice, no false success, no dead button.
- [ ] Dismiss the agent-setup modal with **Escape**, restart Obsidian: it should offer again.
  Dismiss with **Cancel**: it should stay off. (These used to be the same event.)
- [ ] `- [-] Dropped` inside a milestone: the milestone can reach done, and the row reads
  Cancelled — on a board with **no** custom columns.
- [ ] Narrow / touch-emulated pane: the hover buttons are visible and tappable, and in a wide
  pane a click in the row's empty space never triggers Delete.
- [ ] Dashboard with a dependency-held leaf: it appears under "Waiting on dependencies" and
  **not** under "Next up".

## Regression guard

- [ ] With `examples/projects/website-redesign.md`: perform one move + one rename + one id-assign,
  then `git diff` — only the intended lines changed; no `^id` lost, no `tt-` field lost.

## Environments

- [ ] Light and dark theme.
- [ ] Narrow pane (~mobile width) — `isDesktopOnly: false` is a promise: layouts scroll, nothing overflows.
- [ ] A board using 4-space indentation instead of tabs — moves/inserts match the file's style.
