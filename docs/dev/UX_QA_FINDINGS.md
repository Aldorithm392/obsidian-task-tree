---
type: task-tree
title: UX QA Findings — 2026-07-23
description: Interactive UX/CX session driven on-screen; fixed items are checked, open items are the backlog to attack.
tags: [qa, ux]
---

- [x] Fixed and verified live this session
	- [x] Capture flow — "Add task" (button, hover +, menu) now opens the new row already in edit mode; Enter saves AND chains the next sibling; an untouched placeholder deletes itself (no "New task" litter)
	- [x] List rows capped at 920px — status chips and hover actions now sit next to the text instead of the far window edge (proximity + Fitts)
	- [x] Dependency edges — gap-based anchor routing; curves connect box edges cleanly instead of looping across stacked nodes
	- [x] Diagram parent boxes — width max-content + the child column no longer squeezes parents into slivers
	- [x] Generated notes — no body H1 (Obsidian's inline title was showing every title twice)
	- [x] Earlier round: checkbox one-click Done toggle; own-note link hidden (no duplicate titles); data-status rename (Obsidian core CSS repainted our checkboxes); true Miller columns
	- [x] Moving a board broke DEFERRED background views ("No board open") — Obsidian doesn't instantiate background tabs, so their rename listener never ran; a plugin-level vault rename listener now patches every leaf's state, live or deferred
- [ ] Open — attack next
	- [x] Escape cancelling inline edit: now bound at the CAPTURE phase as well as the bubble phase, so a global hotkey layer (AutoHotkey/PowerToys) swallowing the bubbling keydown can no longer cost the user their cancel. `finish` is idempotent, so both paths firing is harmless
	- [x] Diagram spacing — **measured, and the original diagnosis was wrong.** Rendered the real DOM against the real stylesheet in headless Chromium (`docs/dev/VISUAL_HARNESS.md`). Findings: (1) the canvas height is *leaf-bound* — it equals `leaves × (row + gap)`, so it is already optimal for this layout family; (2) `align-items` is irrelevant — centre and flex-start both produce **exactly 460px**, flex-start merely pools the whitespace at the bottom and made the worst sibling gap *worse* (98px → 116px); (3) only the row gap moves height at all (8px → 4px = 460 → 420). The perceived "gap" is a parent box centred against a tall subtree, which is inherent. A genuinely tighter tree needs contour-based packing (Reingold–Tilford), tracked as a v1.2 candidate. What shipped instead was the **opposite** of tightening — see the density pass below, which is what the view actually needed
	- [x] The tree views were cramped overall — shipped a spacing/hierarchy pass ("Canvas"): spacing tokens on `.tt-view`, roomier rows, indent guides in the list, diagram nodes as cards on a subtle dot-grid canvas, depth-aware type weight, and a status edge on diagram cards. The old dense packing is preserved as the **Compact** density setting
	- [x] Kanban: an empty column now renders a dashed "Drop a task here to mark it <Column>" target, hidden by CSS the moment the column holds a card (mid-drag included)
	- [x] "Mark as …" / "Move to …" menu entries now carry a per-role icon (todo `circle` · doing `play` · done `check` · cancelled `x` · blocked `ban`) instead of five identical checks
	- [x] Inline-edit input capped at `min(100%, 520px)` — it no longer stretches window-wide in the diagram/columns layouts
	- [x] Keyboard-only path — **closed**. Arrow navigation now covers all three layouts (list and diagram share one handler; columns get Miller semantics where → drills in and ← steps out), Enter edits in place, Space toggles done, Alt+arrows do move/indent/outdent, and the menu key (or Shift+F10) opens the context menu at the row. Plus an "Add a task to the open board" command that takes a hotkey
	- [x] Starter tasks and note headings are no longer hard-coded: both are settings (`newBoardStarterTasks`, `taskNoteSections`), parsed by `src/model/templates.ts`. An empty starter template is legal — the tree then shows an "Add the first task" state
	- [x] Task pickers are accent-insensitive: `dia` finds `día`. `foldDiacritics` is length-preserving against the NFC display form, so fuzzy-match highlight ranges still land on the right characters (`src/model/fuzzy.ts`)
	- [x] Task-note frontmatter staleness SOLVED systemically: reconcile-on-render heals parent/depth/path/title/board no matter who restructured (plugin, agent, hand edit); deleted tasks mark their notes `task_status: orphaned` (undo clears it); plus a "Resync all task-note frontmatter" command — verified live (external restructure + parent rename both healed)
	- [ ] Verified: moving task-notes and boards across folders keeps everything resolving (links, note round-trip, write-back) — covered by basename resolution + the new leaf-state patch
- [x] Round 4 — the deep philosophy/UX audit (1.1.1). Six defects, all verified against the code before fixing:
	- [x] **The plugin wrote characters it could not read back.** `DEFAULT_COLUMNS` has no `-` or `!`, yet `canonicalStatusForRole` emits exactly those for cancelled/blocked and the contract *installed in the user's vault* tells agents to write them. Both read back as `doing`, so a cancelled child kept its milestone from **ever** reaching done. `roleForStatus` now honours the published table as a fallback after the board's own columns. Root cause: the whole test suite used a five-role fixture no user ships with — the suite validated the plugin we meant to build. Added conformance tests against `DEFAULT_COLUMNS`
	- [x] **"Build the boards index" destroyed files it didn't own.** The update lambda discarded existing content, and with an empty new-board folder the path resolves to `index.md` **at the vault root** — one of the most common MOC filenames in Obsidian. Bundle files now carry an ownership marker and the commands refuse to touch anything else. (The report claimed `log.md` had the same shape; measured, it does not — `appendLogEntry` preserves existing content. Guarded anyway, since writing into a stranger's `log.md` is still a surprise.)
	- [x] **Invisible live tap targets.** `.tt-row-btn` was `opacity: 0` with `cursor: pointer` and no `pointer-events: none`; `styles.css` has **zero `@media` queries** and the manifest claims mobile support. Delete was an invisible target. Hidden buttons no longer receive events, and `@media (hover: none)` makes them permanently visible on touch
	- [x] **Escape was recorded as a permanent "no".** `confirmModal`'s Cancel button never set `answered`, so dismissing and rejecting were indistinguishable — and the agent-setup caller persisted both as `agentInstructions: "off"` forever. It now reports `confirm` / `reject` / `dismiss`; only an explicit Cancel is remembered
	- [x] **"Next up" contradicted itself.** A dependency-held leaf appeared under *Next up* AND *Waiting on dependencies* in the same panel (reproducible with `t-qa` in `examples/`). Now excludes held leaves and leaves under an ancestor explicitly overridden to done/cancelled. Note: only the **override** counts, never a rolled-up role — roll-up lets children win over a parent's character, so a parent merely typed `[-]` with a live child legitimately reads `todo`
	- [x] **The ribbon converted files without asking.** It wrote `type: task-tree` into whatever note was open and then appended `^ids` to every checklist line — two unrequested mutations, one click, against `docs/00_VISION.md`'s "never surprise the human's files silently". The consent screen already existed and simply wasn't routed through. Also fixed: a note declaring a different `type:` used to get a success notice and a dead button
- [ ] Parked ideas (polish)
	- [ ] Soft cluster background per top-level branch in the diagram for scanability
	- [ ] WIP-limit breach could pulse the column header subtly, not just tint the count
	- [x] Note-progress badge (pending checklists inside a task's note) — shipped in v1.1, recursive through linked task-notes, read-only, never feeds roll-up
	- [ ] Clicking the note-progress badge could open the note at its first unfinished item
- [ ] To verify live (v1.1, GUI-only — the logic is unit-tested, the pixels are not)
	- [ ] Note-progress badge appears on a task whose note has checklists, counts recursively through a linked task-note, and shows `+` when the depth cap bites
	- [ ] Arrow navigation: focus ring visible in light and dark, ←→ fold/unfold keeps focus on the same row after the re-render, Space toggles done without page-scrolling
	- [ ] "Add a task to the open board" command works with the tree in a sidebar and with only the Kanban open
	- [ ] Accent-insensitive picker: `dia` matches `día` AND the highlight lands on the right characters
	- [ ] A board created with an empty starter template opens on the "Add the first task" state
