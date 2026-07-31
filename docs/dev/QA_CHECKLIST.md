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
- [ ] Kanban: drag between columns flips exactly one status char (check the file diff!). An empty
  column shows the dashed drop target, and it vanishes as soon as a card lands there.
- [ ] Context menus show a distinct icon per role, not five checks.
- [ ] Dashboard: stats, Blockers, "Waiting on dependencies" (when edges are held), Next up.
- [ ] Markdown in task text renders (a `[[link]]`, `**bold**`, a `#tag`); clicking a link opens it;
  clicking plain text starts the inline edit.

## Editing (watch the file after every action — this is the real assertion)

- [ ] Inline rename (click / double-click by view): Enter saves, Esc cancels, blur saves; the line
  keeps its status, override, blocked-by, and `^id`.
- [ ] + / − hover buttons on nodes in every layout.
- [ ] Context menu: mark as each **role** (same wording in tree and Kanban), override set + clear, move up/down, indent/outdent,
  add subtask/sibling, rename, tag, delete (confirm on subtree).
- [ ] Drag-reparent (list grip, diagram) — children travel; only indent/order changes.
- [ ] "Waiting on…" picker: adds `[tt-blocked-by:: …]` before `^id`; picking again removes; "Stop
  waiting on other tasks" removes the field; badge + overlay update.
- [ ] Rename board (header / goal box): frontmatter `title` set AND the file renamed; a `[[link]]`
  to the board from another note still resolves; the open view stays bound.

## Task = note

- [ ] "Open / create note": creates in the configured folder with self-describing frontmatter,
  appends the trailing `[[link]]`, opens in a new tab. Re-invoke → just opens.
- [ ] Rename the task's parent → the note's `parent` frontmatter resyncs on the next render.
- [ ] Note sections match the "Task-note sections" setting; emptying it creates a note that is
  just frontmatter.

## Depth: recursive note progress

- [ ] Add `- [ ]` / `- [x]` items to a task's note → the board task reads "N in notes"; ticking an
  item in the note updates it, and **no board status character changes**.
- [ ] Link a second `type: task-note` from that note, give it checklists → the badge counts both;
  the dashboard lists the task under "Open inside linked notes".
- [ ] Set the depth to 1 → the badge drops the deeper counts and shows a trailing `+`.
- [ ] Finish every checklist item in the notes → the badge disappears entirely.
- [ ] Link two notes to each other (a cycle) → the badge is finite and the view still renders.
- [ ] Link a note to a plain note that is NOT `type: task-note` → its checklists are ignored.
- [ ] Turn "Show note progress" off → every badge disappears; nothing else changes.

## Folding — what the board shows when it opens

- [ ] Open a board 4 levels deep → only roots and their children are drawn; everything below is
  folded. Switch to the **diagram** without touching anything → **the same** branches are folded.
- [ ] Every folded parent still shows its state chip **and** its `K/D`. A parent you cannot judge
  without opening it is the failure mode this whole default is betting against.
- [ ] Unfold a deep branch, switch layouts, switch files and come back → it is **still open**
  (an explicit choice outranks the depth default, permanently and in both directions).
- [ ] Fold a root, reopen the board → still folded. Fold-all → everything shuts; the toolbar icon
  flips; unfold-all reopens.
- [ ] A chevron never points right over a branch that is drawn open, in **either** layout.

## Keyboard (both layouts)

- [ ] Tab once into the tree, then ↑ ↓ walk rows with a visible focus ring (light **and** dark) —
  check the list **and** the diagram.
- [ ] → opens a collapsed branch and ← closes an open one, **keeping focus on the same row**;
  ← on a leaf jumps to its parent.
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

## The five roles (1.6.0)

- [ ] On a board with **no** custom columns, right-click a task: the menu offers all five —
  To Do, Doing, Blocked, Done, **Cancelled**. This is the one that did not exist before 1.6.
- [ ] Mark a leaf Cancelled: the line becomes `[-]`, the row **recedes** (and reads legibly —
  check the chip in light *and* dark), and its parent's fraction loses it from the denominator.
- [ ] The Kanban shows a **Blocked** lane by default and **no** Cancelled lane. Mark something
  cancelled → a Cancelled lane appears to hold it. Unmark it → the lane goes away again.
- [ ] Drag a card **into** that on-demand lane: it writes `[-]`, exactly like the menu would.
  (The lane's id exists only for this render — a drop that resolved against `columns` would
  silently do nothing.)
- [ ] Cancelled cards are never in To Do — the old fallback put every unhoused role there.
- [ ] Create a new board: the first frame shows `1/2` on the first task, a half-filled bar, and
  a parent that is visibly **not** done. If it opens all-unchecked, the tutorial is broken.
- [ ] Edit the starter template to a line with `[x]` in it, create a board: the character lands.

## The membrane (1.3.0)

- [ ] With DEFAULT columns, a board gains **no** `tt_columns` on render — check the file is untouched.
- [ ] Remap a column to a character the published table doesn't name (e.g. `>` → doing), open a board:
  `tt_columns` is written into its frontmatter **once**, and the file is stable on later renders.
- [ ] Open that board on a second machine with default settings: the characters still mean the same.
- [ ] A task typed `[?]` shows an "unmapped" chip naming the character, not a confident role label.
- [ ] A task-note created today has `title`, `board`, `parent`, `task_id` — and **no** `depth`,
  `distance_to_main` or `path`.
- [ ] An OLD task-note that still carries those three: they are removed on the next board render,
  and the note's body is untouched.

## Derived state is not directly settable (1.4.0)

- [ ] Click a parent's checkbox: **nothing is written** (check the file) and a notice explains what
  it derives from. Same for Space on a focused parent row.
- [ ] A task with only a plain `- note` bullet under it is NOT derived — its checkbox still works.
- [ ] Kanban: a parent card does not drag between columns; a leaf still does. The card shows a
  "derived" tag rather than looking broken.
- [ ] Right-click a parent: the items read **"Override to …"**. Right-click a leaf: **"Mark as …"**.
  Both views use the same wording.
- [ ] Overriding from the menu still writes `[tt-override:: role]` on the line, and "Clear manual
  override" removes it.
- [ ] A row with note work reads "N in notes", never a second bare `K/D` next to the roll-up's.
  A task whose notes are fully done shows no note badge at all.
- [ ] ⚠ appears only where the row's own chip is NOT already Blocked — i.e. on an ancestor
  overridden to done/cancelled that is hiding blocked work underneath.
- [ ] The dependency badge reads "waiting on N"; the menu says "Waiting on…".

## Next-up leverage (1.7.0)

With `examples/projects/website-redesign.md` open as a dashboard:

- [ ] "Next up" carries one italic rule line: *In flight first, then whatever frees the most work.*
- [ ] **Pricing page** reads `completes 2 milestones` (Wireframes, then Design) and sorts above
  **Photography**, which carries no badge at all — its sibling *Copywriting* is still blocked.
- [ ] Mark *Copywriting* done: **Photography** picks up `completes "Content"` on the next render.
- [ ] Add `[tt-override:: doing]` to *Design*: **Pricing page** drops to `completes "Wireframes"`
  — the cascade must stop at an ancestor whose override, not its children, decides it.
- [ ] Set *Staging box* to a leaf outside the overridden Infrastructure branch (or clear the
  override): it should read `unblocks 1` — *QA pass* waits only on it, while *Announcement post*
  would still be held by *Copywriting*, so it must **not** count as 2.
- [ ] Set any task to `[/]`: it jumps above every not-started task, however much leverage they
  carry.

## Column colour is a snippet now (1.8.0)

- [ ] Settings → a column row has exactly four controls: name, character, role, remove. No colour
  picker, no WIP box, no eraser button.
- [ ] **Upgrade path, with a real pre-1.8 `data.json`:** add `"color": "#8888ff"` and
  `"wipLimit": 3` to two entries of `columns`, restart Obsidian, then reopen `data.json` — both
  keys are gone and every other setting survived. Restart again: the file must **not** be
  rewritten a second time (the prune is idempotent).
- [ ] A board whose frontmatter carries `tt_columns` with a hand-written `color:` key still opens,
  the column reads normally, and **the key is still in the file afterwards** — ignored, never
  stripped.
- [ ] Lanes are tinted by role out of the box — Doing amber, Blocked red, Done green, To Do and
  Cancelled grey — in light **and** dark. No two lanes share an edge colour except To Do/Cancelled.
- [ ] The README snippet works verbatim as a vault CSS snippet: `.tt-column[data-role="doing"]`
  overrides that lane's default tint, and `.tt-chip[data-role="blocked"]` retints the chip.

## Regression guard

- [ ] With `examples/projects/website-redesign.md`: perform one move + one rename + one id-assign,
  then `git diff` — only the intended lines changed; no `^id` lost, no `tt-` field lost.

## Environments

- [ ] Light and dark theme.
- [ ] Narrow pane (~mobile width) — `isDesktopOnly: false` is a promise: layouts scroll, nothing overflows.
- [ ] A board using 4-space indentation instead of tabs — moves/inserts match the file's style.
