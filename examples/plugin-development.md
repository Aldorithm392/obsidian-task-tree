---
type: task-tree
title: Task Tree — Development
description: The plugin's own roadmap, tracked in the plugin (dogfooding). Reset on 2026-07-19.
tags: [meta, dogfood]
---

- [x] Shipped
	- [x] Format & parser (roll-up, override, block ids)
	- [x] Views — Kanban + Tree
	- [x] Three layouts (list / diagram / columns) + full-focus
	- [x] Editing — add / delete / rename / tag, inline + / −
	- [x] Drag (grip) + Move up / down / Indent / Outdent
	- [x] Clean default view (stats opt-in)
	- [x] Fix: outdent last child was a no-op
- [/] Now — edit everything from the view
	- [ ] Inline text editing in every view (write on tasks, never open the file)
	- [ ] The plugin creates & manages files
		- [ ] "New board from zero" command
		- [ ] Default folder setting (where new notes go)
		- [ ] YAML title = note title (rename the board renames the file)
- [ ] Next — task = note
	- [ ] Open each task as its own note ([[link]]) for progress / status / code
	- [ ] Give each task-note its own YAML frontmatter so an agent reads it standalone
		- [ ] type + how to read the note
		- [ ] parent — link to the parent task's note
		- [ ] position in the tree: depth, path from root, distance to the main task
- [ ] Advanced — connect tasks to each other (dependencies / graph)
- [ ] Ship
	- [ ] Fill author / GitHub handle in manifest.json
	- [ ] Manual QA pass in a real vault
	- [ ] Tag a release
	- [ ] Submit to community plugins
