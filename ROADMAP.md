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
  drill-down); remembered per board via view state. *(Columns removed in v1.5 — see below.)*
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

## Shipped (v1.1 — depth through notes, and the keyboard)

- **Recursive task detection across linked notes.** A task's own note can carry its own checklists
  and links to deeper task-notes; the board follows that trail and badges the task with the work it
  finds (board task → its note's checklists → *their* linked notes → …). Read-only, computed from the
  metadata cache, gated on `type: task-note`, with a visited-set cycle guard, a depth cap (setting,
  default 3) and a hard note budget. A *separate signal* — never feeds roll-up — so each file's state
  stays recomputable from that file alone. Surfaced as a badge in every view and an "Open inside
  linked notes" section on the dashboard. `src/model/noteprogress.ts`, unit-tested.
- **The keyboard path.** Arrow-key navigation through the tree (↑↓ to walk, ←→ to fold, Enter to edit
  in place, Space to toggle done) on a roving tabindex with ARIA tree semantics, plus an
  "Add a task to the open board" command that can take a hotkey. Capture no longer requires a mouse.
- **Accent-insensitive pickers.** Typing `dia` now finds `día`. Length-preserving diacritic folding,
  so fuzzy-match highlighting still lands on the right characters (`src/model/fuzzy.ts`).
- **Generated text is no longer hard-coded English.** New-board starter tasks and task-note section
  headings are settings; an empty starter template is legal and the tree offers to add the first task.
- **QA round 3 fixes:** empty Kanban columns show a drop target · per-role icons in the "Mark as…" /
  "Move to…" menus instead of five identical checks · the inline-edit field is capped instead of
  stretching window-wide in the diagram/columns layouts · Escape is also bound at the capture phase
  so a global hotkey layer can't swallow "cancel this edit".

- **Room to breathe (the design pass).** The tree views were built dense and read as a spreadsheet.
  Spacing now lives in tokens on `.tt-view`: roomier rows and cards, indent guides in the list,
  diagram nodes as cards floating on a subtle dot-grid canvas, depth-aware type weight so milestones
  outrank leaves, and a status edge on diagram cards. The old packing survives as the **Compact**
  density setting. Designed against renders from `tools/visual/`, in light and dark.
- **A visual harness** (`tools/visual/`, `docs/dev/VISUAL_HARNESS.md`): the views' real DOM + the real
  stylesheet, screenshotted in headless Chromium. Layout arguments are now settled with measurements.
  It immediately caught a v1.0 bug — the inverted diagram drew its dependency edges through a
  mirrored transform using screen coordinates, so every curve pointed at the wrong task.

## Shipped (v1.2 — the audit, and the subtraction)

A 22-agent philosophy/UX study plus two competitive deep-dives. Every finding was re-verified
against the code before acting on it, and two of the report's own claims were wrong and are
recorded as such in `docs/dev/UX_QA_FINDINGS.md`.

- **1.1.1 — six defects, two of which cost data.** The plugin wrote status characters it could not
  read back (`-` and `!` both came back as `doing`, so an agent obeying the contract we install in
  the user's vault could stop a milestone from ever completing); "Build the boards index" rewrote a
  vault-root `index.md` wholesale; hidden row buttons were invisible live tap targets on touch;
  Escape was recorded as a permanent "no"; "Next up" recommended tasks it simultaneously called
  blocked; and the ribbon converted whatever note was open without asking.
- **The surface came down.** 23 settings → 12, 11 commands → 8, and the tree/Kanban menus now use
  one vocabulary. The cuts were not preferences: `unknownRole`, `blockedDominates`, id shape and
  indent unit are now `FROZEN` constants with the answer the documentation always published;
  `parentAutoSync` was dead code shipped in every user's `data.json`; the index/log generators were a
  second artifact that could only drift from a vault an agent can already enumerate by grep.
- **A settings rule, written down.** A setting is a permanent branch in the code, the spec, the agent
  contract, the in-vault skill and the QA matrix. It has to earn all five.

## Shipped (v1.3 — the membrane, both ways)

The audit's headline finding was that Task Tree's membrane ran backwards: meaning a reader needs
was outside the file, and derivations a reader can recompute were inside files the plugin doesn't
own. Both directions are now fixed, and the four normative documents were updated in the same
commit as the code.

- **The board says what its own characters mean.** `tt_columns` had two readers and **zero
  producers** — nothing in the codebase ever wrote it, so a board whose author remapped `[/]` carried
  that meaning only in `data.json`. Same file, second machine, different semantics; and an AI agent
  reading the raw Markdown had nothing to read, while the contract we install in users' vaults told
  it to "check `tt_columns` first". It is now stamped once, automatically, when a board's char→role
  mapping deviates from the **published** table — not from the reader's settings, which is circular
  and is the bug itself. Boards using only published characters stay clean.
- **An unmapped character says so.** A char nothing claims still reads as `doing`, but the row now
  shows `[?] unmapped` instead of a confident label. A silent guess becomes a one-click fix.
- **Derivations left the notes.** Task-notes carried `depth`, `distance_to_main` and `path` — pure
  functions of the board, kept true only by a background reconcile, and `distance_to_main` was
  literally `depth` under a second name. Delete the plugin and they don't vanish; they start lying.
  Notes now carry `title` / `board` / `parent` / `task_id`, and the reconcile **strips** the retired
  keys on next touch — because stopping the writes alone would leave them rotting with nothing
  marking them stale, which is worse than maintaining them.
- **`tt_rollup` deleted from the spec.** It was documented for a release and never existed in code.

## Shipped (v1.4 — derived state stops being clickable)

- **The plugin now obeys the rule it teaches.** `AGENTS.md` invariant 8 tells agents never to mark a
  parent's checkbox done — and three gestures did exactly that, writing `[tt-override:: done]`
  without ever saying "override": the parent checkbox, a Kanban drag, and "Mark as Done". A derived
  parent's checkbox is now a readout that explains itself; parent cards are out of the drag pool but
  stay visible with their progress; and the menu names the action, "Override to …" vs "Mark as …".
  README's promise that *a parent can never lie about being complete* is now structurally true
  rather than documentationally true.
- **The derivation predicate is shared.** `isDerived` lives beside `computeRollup` and is the exact
  same test, so the UI cannot disagree with roll-up about which rows are the user's to set. It is
  deliberately not `isLeaf`, which counts non-task bullets.
- **Row noise down.** Note-progress reads "8 in notes" and disappears when finished — two adjacent
  `K/D` fractions counting categorically different things was the row's worst ambiguity. ⚠ shows only
  where the chip isn't already Blocked, i.e. where an override is hiding blocked work.
- **One word, one meaning.** Dependencies say "waiting on"; `blocked` goes back to being a role.

## Shipped (v1.5 — one scope, one hiding gesture)

- **The board opens shallow.** Roll-up computes, for every parent, the one number that answers *how
  is that going* — and the view then opened every branch and spent that signal before the user saw
  it. Boards now open two levels deep (`FROZEN.openDepth`). Measured on the harness: the list
  fixture went 451px → 325px of content and the diagram 707px → 519px, which is the difference
  between a board that fits a pane and one that doesn't. A folded parent keeps its chip *and* its
  `K/D`, which is the whole bet: that fraction is permission not to look.
- **Folding became tri-state, necessarily.** Once a depth default exists, "not in `collapsed`" can no
  longer mean "open" — a hand-opened branch would silently re-fold the next time the default was
  applied. An explicit choice outranks depth forever, in *either* direction. The rule is pure
  (`src/model/folding.ts`) so the off-by-one is a test, not a screenshot surprise.
- **Four hiding mechanisms became one.** Deleted: the full-focus tab (five indistinguishable tabs —
  `getDisplayText` returned the same string for each), the Miller **Columns** layout, `columnPath`,
  `wireColumnsKeyboard`, the three-way layout switch, and one of the two near-identical focus items.
  The evidence Columns was redundant was already in the code: `setFocus` had to *clear the drill
  path* so two hiding mechanisms wouldn't contradict each other. Both remaining layouts read one
  fold state, and a test fails on any raw `collapsed.has(id)` — the drift that had the diagram
  drawing an open branch under a chevron pointing right.

## Shipped (v1.6 — the five roles become reachable)

- **The plugin could read a state its owner could not write.** The context menu was built by
  iterating `model.columns`, so on a default board "Mark as Cancelled" did not exist — while the
  README advertised cancelled, roll-up excluded it from the denominator, and the `CONTRACT.md` the
  plugin installs in the user's own vault told *agents* to write `[-]`. The human's collaborator
  could produce a state the human couldn't. Menus now offer every **role**: which lanes a board
  draws is a layout choice, and it was never meant to decide which states a task may be in.
- **`blocked` gets a default lane; `cancelled` deliberately doesn't.** Blocked work is in the flow
  and is the lane you most want to see filling up. Cancelled work is out of it, and a permanently
  empty column would tax every board for a state most never reach. Neither is a reinterpretation —
  `roleForStatus` has honoured the published table since 1.1.1.
- **Cancelled cards no longer land in To Do.** The Kanban fell back to `columns[0]` for any role
  without a column, so work you had explicitly decided *not* to do came back as the top of your
  backlog. `boardLanes` gives a role a lane exactly when the board has tasks in it — neither a
  permanent empty column nor a card the plugin quietly hides.
- **A cancelled row recedes instead of reading as finished**, which is what earns cancelled the
  right to have no lane: the state is visible wherever the task is. Measured in the harness: the
  chip's own fade plus the new row fade compounded into an unreadable label in both themes, so the
  row now carries the recession and the chip carries the word.
- **The first frame of a new board teaches roll-up.** The starter template marked nothing, so `K/D`
  never rendered and every new user's first board omitted the one mechanism no competing plugin
  copies. One subtask now starts done: `1/2`, a half-filled bar, and a parent visibly not done.
- **The manifest stopped advertising the commodity.** It led with roll-up — which Task Genius (151k)
  and CardBoard (170k) also ship, and both *mutate the parent*, destroying recomputability. After
  1.3–1.5 the invariant is structurally true, so it is finally the thing we claim: *never writes a
  fact your Markdown doesn't already carry.*

## Shipped (v1.7 — the panel says why)

- **"Next up" is ordered by derived leverage, and there is still no priority field.** The whole
  Eisenhower/priority category on Obsidian is 3,762 downloads across 12 plugins — mostly maintained,
  so that is not abandonment, it is non-adoption; and every one of them needs an "unjudged" drawer,
  because asking the user to rate work is handing them the complexity (Tesler). The board already
  knew the answer: `resolveEdges` knows what waits on what, `computeRollup` knows how many siblings
  are left. The panel simply wasn't reading it. Zero new syntax, nothing to keep up to date.
- **`unblocks N` counts strictly.** A waiter is counted only when the task is the **last unreleased
  thing** it depends on. Saying "3 are waiting on you" when two would stay stuck behind something
  else makes the badge a promise the board can't keep, and an overstated number is worse than none.
- **`completes "X"` cascades, and stops at an override.** Clearing the last open leaf under a
  milestone closes it — and closes its parent too when that milestone was the last thing open there.
  It stops at any ancestor carrying `tt-override`, because an overridden node is no longer decided
  by its children, so finishing the leaf would not close it.
- **In-flight work still sorts first, whatever the leverage.** You already paid the cost of loading
  that context, and a "next up" list that nudges you to drop work in progress to open a new front
  has exactly one failure mode and that is it. Leverage sorts *within* each tier.
- **One line of rule, not eight badges.** The ordering is stated once above the list; a row with no
  leverage gets no badge, because the absence is information too.

## Next (v1.8+ — candidates, not commitments)

- **Diagram packing, properly.** Measured (see `docs/dev/VISUAL_HARNESS.md`): canvas height is
  leaf-bound and completely insensitive to `align-items`, so no CSS tweak will do it. A genuinely
  tighter tree needs contour-based packing (Reingold–Tilford) with absolute positioning — a real
  layout engine, worth doing only with the harness to verify it.
- **Note progress, deeper.** Today the badge counts checklist items. Clicking it could open the note
  at the first unfinished item, and the walk could report *which* note holds the backlog.
- **Harness as a regression gate.** The renders are deterministic; snapshotting them in CI would
  catch layout regressions that no unit test can see.

## Later — through the philosophy's filter

Capabilities other plugins already do well, deliberately not cloned yet. Each may join **only** if
it passes the three commitments in the README (clarity is the product · cross standard pieces ·
Markdown stays the ground truth) — announced in the file, recomputable from the file, never hidden
plugin state:

- **Dates & scheduling** — a `tt-due::`-style announced field could give boards a time lens
  (timeline / "what's due" views) without emoji metadata or hidden state.
- **Recurrence** — only if a recurring task can be expressed legibly in the line itself.
- **Global queries** — "every blocked task across all boards" as a lens over the OKF bundle
  (`index.md` already lists the boards; insights already compute per board).
- **Tasks-plugin interop** — read their statuses gracefully (status chars already align); never
  emit their emoji format.

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
