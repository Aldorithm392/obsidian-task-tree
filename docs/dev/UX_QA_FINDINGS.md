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
- [ ] Open — attack next
	- [ ] Verify Escape cancels inline edit with a physical keyboard — synthetic ESC may have been eaten by AutoHotkey/PowerToys during testing; if genuinely broken, bind Esc at capture phase too
	- [ ] Diagram spacing: large vertical gaps between sibling groups when their subtree heights differ — consider tighter packing
	- [ ] Kanban: an empty column gives no "drop here" affordance
	- [ ] "Mark as …" menu entries share one generic check icon — per-role icons or column-colored dots would scan faster
	- [ ] Inline-edit input still stretches full-width in diagram/columns layouts (list is capped) — size to content or cap
	- [ ] Keyboard-only path: no way to add/navigate/edit tasks without the mouse — a "add task to active board" command + arrow-row navigation would close it
	- [ ] Starter tasks and note headings are English-only — consider locale-aware or neutral templates
- [ ] Parked ideas (polish)
	- [ ] Soft cluster background per top-level branch in the diagram for scanability
	- [ ] WIP-limit breach could pulse the column header subtly, not just tint the count
	- [ ] Note-progress badge (pending checklists inside a task's note) — already scoped as v1.1 Phase 6
