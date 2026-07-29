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
	- [ ] Diagram spacing: large vertical gaps between sibling groups when their subtree heights differ — consider tighter packing. **Still open**: needs a measured layout pass on screen, not a blind CSS tweak
	- [x] Kanban: an empty column now renders a dashed "Drop a task here to mark it <Column>" target, hidden by CSS the moment the column holds a card (mid-drag included)
	- [x] "Mark as …" / "Move to …" menu entries now carry a per-role icon (todo `circle` · doing `play` · done `check` · cancelled `x` · blocked `ban`) instead of five identical checks
	- [x] Inline-edit input capped at `min(100%, 520px)` — it no longer stretches window-wide in the diagram/columns layouts
	- [x] Keyboard-only path: arrow navigation over the list layout (↑↓ walk · ←→ fold/unfold · Enter edits in place · Space toggles done) on a roving tabindex with ARIA tree roles, plus an "Add a task to the open board" command that takes a hotkey. **Partially open**: diagram and columns layouts, and the menu actions (move/indent/outdent), still have no keyboard route
	- [x] Starter tasks and note headings are no longer hard-coded: both are settings (`newBoardStarterTasks`, `taskNoteSections`), parsed by `src/model/templates.ts`. An empty starter template is legal — the tree then shows an "Add the first task" state
	- [x] Task pickers are accent-insensitive: `dia` finds `día`. `foldDiacritics` is length-preserving against the NFC display form, so fuzzy-match highlight ranges still land on the right characters (`src/model/fuzzy.ts`)
	- [x] Task-note frontmatter staleness SOLVED systemically: reconcile-on-render heals parent/depth/path/title/board no matter who restructured (plugin, agent, hand edit); deleted tasks mark their notes `task_status: orphaned` (undo clears it); plus a "Resync all task-note frontmatter" command — verified live (external restructure + parent rename both healed)
	- [ ] Verified: moving task-notes and boards across folders keeps everything resolving (links, note round-trip, write-back) — covered by basename resolution + the new leaf-state patch
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
