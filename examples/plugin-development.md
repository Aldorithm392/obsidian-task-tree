---
type: task-tree
title: Task Tree — Development
description: The plugin's own roadmap, tracked in the plugin (dogfooding).
tags: [meta, dogfood]
---

- [x] MVP (v0.1)
	- [x] Markdown format & parser
		- [x] Parse nested checklist tasks
		- [x] Roll-up parent state from children
		- [x] Stable block ids
	- [x] Views
		- [x] Kanban board (drag = change state)
		- [x] Tree (collapse / focus)
	- [x] Write-back (status, override, move)
	- [x] Pure-logic tests
- [/] v0.2 — layouts, editing
	- [x] Three tree layouts
		- [x] List (vertical)
		- [x] Diagram (horizontal)
		- [x] Columns (drill-down)
	- [x] Full-focus view
	- [x] Task CRUD from the UI
	- [/] Dashboard (simplified to opt-in)
- [/] v0.3 — human-first
	- [x] Clean default view (stats opt-in)
	- [/] Inline + / − to edit from any view
	- [ ] "A task can also be a note" (documentation link)
- [ ] Ship
	- [ ] Fill author / GitHub handle in manifest.json
	- [ ] Manual QA pass in a real vault
	- [ ] Tag a release
	- [ ] Submit to community plugins
