# 📋 Task Tree — Project Guide

> This `docs/` folder is a small Obsidian vault documenting the **Task Tree** plugin. It's adapted
> from a reusable project template; each file explains the *why*, so you don't have to hold it all in
> your head.

**Project:** `Task Tree for Obsidian`
**Status:** ✅ MVP built · ⬜ Community submission

---

## 🧭 How to use these files

| File | What it covers | When to read it |
|------|----------------|-----------------|
| **This file** | Mental model + glossary + checklist | First, once |
| [`01_PLANNING.md`](01_PLANNING.md) | The idea, the three axes, non-goals, the stack | To understand *what* and *why* |
| [`02_SETUP_AND_DEVELOPMENT.md`](02_SETUP_AND_DEVELOPMENT.md) | Building, the dev loop, the Research→Plan→Implement→Test cycle | When hacking on it |
| [`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md) | **The Markdown convention** — the core asset (normative) | Before touching parsing, roll-up, or write-back |
| [`04_OKF_AND_AGENTS.md`](04_OKF_AND_AGENTS.md) | Vault → OKF bundle; how agents read/write state | For the AI-legibility story |
| [`dev/OBSIDIAN_PLUGIN_REFERENCE.md`](dev/OBSIDIAN_PLUGIN_REFERENCE.md) | Verified Obsidian API/scaffolding/publishing reference | When wiring the plugin or releasing |

---

## 🗂️ Glossary

- **Board** — a Markdown file that opts in with `type: task-tree` frontmatter. One project per board.
- **Node / task** — a checklist item `- [ ]`; may have children (subtasks).
- **The three axes** — **X** state (Kanban column), **Y** order (vertical), **Z** depth (tree nesting).
- **Role** — the stable semantic layer: `todo | doing | done | cancelled | blocked`. Columns map to roles.
- **Roll-up** — a parent's state *derived* from its children (deterministic, recomputable).
- **Progress signal** — the rendered `K/D` (+ bar) for a partially-done parent; never stored.
- **Override** — a visible `[tt-override:: role]` marking a hand-set state that beats the roll-up.
- **Operation A / B** — restructure (subtree moves) vs. change-state (one status char flips).
- **Block id** — Obsidian `^id`, the stable node identity; `^t-…` by default.
- **OKF bundle** — a folder of OKF concept files (`index.md`, `log.md`); the agent-ready shape.

---

## ✅ Checklist

### Idea & format → [`01_PLANNING.md`](01_PLANNING.md) · [`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md)
- [x] Defined what it is (tree + Kanban over Markdown) and the objective (cognitive clarity)
- [x] Locked the three axes and the roll-up + override model
- [x] Designed the Markdown convention (opt-in gate, roles, task-line grammar, override)

### Build → [`02_SETUP_AND_DEVELOPMENT.md`](02_SETUP_AND_DEVELOPMENT.md)
- [x] Plugin scaffold (manifest, esbuild, versions.json, release workflow)
- [x] Pure core (`parser`, `rollup`, `writer`, `ids`) + unit tests (`npm test`)
- [x] Kanban view (Operation B via drag) + Tree view (collapse/focus + Operation A)
- [x] Settings (configurable columns, indentation, ids, roll-up)
- [ ] Manual QA in a real vault (drag, roll-up, override, reparent)

### Ship
- [ ] Fill `author` / `authorUrl` in `manifest.json`, push to GitHub
- [ ] Tag a release; verify the Action attaches `main.js`/`manifest.json`/`styles.css`
- [ ] Submit to `obsidianmd/obsidian-releases` (see the reference doc's checklist)
