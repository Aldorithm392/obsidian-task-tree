# 🗄️ Companion · The Task Tree format (the core artifact)

> **Use this the way `03_DATABASE.md` tells you to use a schema.** For a normal app the database is
> the core asset; for Task Tree the **Markdown convention is the core asset** — the contract every
> view, the roll-up, and every AI agent build on. Model the format before the code.
> ↩︎ Back to the [Project Guide](PROJECT_GUIDE.md)

**Guiding principle**
> Children are the source of truth. A parent's state is *derived*. Anything a reader can't infer from
> universal Markdown convention is written down *in the file*.

This document is **normative**: MUST / SHOULD / MAY have their usual meaning.

---

## 0. The opt-in gate

Task Tree MUST only read or write a file whose YAML frontmatter declares:

```yaml
type: task-tree
```

Any other file — including plain checklists — MUST be left untouched. `type` is also the single
required field of Google's Open Knowledge Format, so this gate doubles as OKF compliance
(see [`04_OKF_AND_AGENTS.md`](04_OKF_AND_AGENTS.md)).

**Interpretation principle** (decides what goes in the file vs. in plugin settings):
> Anything a reader must know to *interpret* the file lives **in the file**. Anything that only
> affects how the plugin *authors or displays* lives **in settings**.

---

## 1. The board file (an OKF concept document)

One **project = one file**. Tasks are sub-concepts inside it, addressed by block id. (This is a
deliberate, documented deviation from OKF's “one concept per file”: the readable single-file tree
*is* the product.)

### Frontmatter

```yaml
---
type: task-tree            # REQUIRED — the opt-in gate
title: Website Redesign    # SHOULD (OKF) — display name
description: Q3 rebuild.    # SHOULD (OKF) — one sentence
tags: [project, marketing] # MAY (OKF)
timestamp: 2026-07-19T14:30:00Z  # MAY (OKF) — ISO 8601; yours to maintain, the plugin never writes it
tt_columns:                # REQUIRED when the board deviates from the PUBLISHED table below
  - { name: To Do,   status: " ", role: todo }
  - { name: Doing,   status: "/", role: doing }
  - { name: Blocked, status: "!", role: blocked }
  - { name: Done,    status: "x", role: done }
---
```

- Task Tree reads/writes only the `tt_*` keys. Every other key — yours or another tool's — MUST be
  preserved on round-trip.
- **`tt_columns` is compared against the published table, never against the reader's settings.**
  Comparing a board to the reader's own configuration is circular: a board could match its author's
  setup perfectly and still be unreadable to anyone else, which is exactly the bug this rule fixes.
  The plugin stamps it automatically, once, the first time a deviating board renders. A board that
  uses only published characters needs nothing — that is why most boards carry no `tt_columns`.
  Once stamped, the board owns its meaning: later changes to a vault default do not reach back in.
- **Format/spec version markers are NOT stamped into board files.** They are documentation, not
  user data (that decision is intentional — see [`ROADMAP.md`](../ROADMAP.md)).

### Columns and roles

Columns are user-configurable (name + one status character each). The vault default equals the
universal Obsidian/Tasks convention, so a board that declares nothing is still self-describing:

| Column | status char | role |
|--------|-------------|------|
| To Do  | `" "` space | `todo` |
| Doing  | `/`         | `doing` |
| Done   | `x` (also `X`) | `done` |

Two more characters are **published** and always mean what they say, even on a board whose columns
don't list them: `-` = `cancelled` and `!` = `blocked`. So adding a Blocked or Cancelled column
changes nothing about how the file reads, and needs no declaration.

A board that gives a character a *different* meaning — or uses one this table doesn't name — MUST
declare its full `tt_columns`. That is how a non-standard board *announces itself* so it reads the
same on any machine, with or without the plugin. The plugin writes it for you, once.

Every column carries a **role**: `todo | doing | done | cancelled | blocked`. Column names and
characters may change; **roles are the stable contract** that roll-up and overrides consume.

---

## 2. The task line

```
<indent><marker> [<status>] <text> [tt-override:: <role>]? [tt-blocked-by:: <id>, <id>…]? ^<id>?
```

Example (one tab per depth level):

```markdown
- [/] Analytics wiring ^t-77e1
	- [x] GA4 base tag ^t-5d21
	- [ ] Conversion events ^t-0f18
```

- **Indentation MUST be one consistent unit per level; TAB is recommended.** Obsidian resolves
  nesting from its metadata cache regardless of width, but *writing* moved lines needs one unit — a
  tab is exactly one level, with no 2-vs-4-space ambiguity. The plugin **detects** the unit a file
  already uses and matches it; a tab is only its starting point for a board with no nesting yet.
- **Marker** is `-`, `*`, or `+` (preserved on rewrite).
- **Status character** is the single char in `[ ]`. `" "` = incomplete; any other char = a status
  symbol. Matched against `tt_columns`; `x`/`X` are equivalent.
- **Block id `^<id>`** MUST be the last token on the line. Scheme `^t-<6 base36>`. Existing ids are
  adopted, never regenerated — this is what lets a subtree move (Operation A) without breaking links
  or the override marker. Every task in a managed board gets one, written once as a guarded batch.
- **Overrides** use the inline field `[tt-override:: <role>]`, placed before the block id (§4).
- **Dependencies** use the inline field `[tt-blocked-by:: <id>, <id>…]`, placed before the block id
  (§4b). Values are bare block ids (no `^`), same board only.
- Task Tree MUST NOT emit Tasks-plugin metadata emoji (📅 ⏳ 🛫 ✅ 🔁 🔼 …); its only fields are the
  `tt-`-namespaced ones above, which Tasks ignores and Dataview can query.

---

## 3. Roll-up (deterministic; any agent can recompute it)

Compute **post-order** (children first). For a node:

```
role(node):
    if node has [tt-override:: R]:            return R           # override wins
    taskChildren = direct children that are tasks
    if taskChildren is empty:                 return literal_role(node)   # leaf: its own char
    active = taskChildren where role != cancelled
    if active is empty:                       return cancelled
    if every active is done:                  return done
    if any active is blocked (and blocked-surfaces-to-parent): return blocked
    if any active is doing/done/blocked:      return doing
    else:                                     return todo

progress(node) = (active that are done) / (active)      # rendered, NEVER written to the file
```

- The **progress signal `K/D`** is a pure function of the children and is never stored.
- The parent's on-disk checkbox is a **derived mirror**. On any disagreement, **children win**
  (or an override wins). Agents recompute; they never trust a parent character.

### Edge cases

| Case | Resolution |
|------|------------|
| Leaf / empty parent | Not derived; its own status char is authoritative. |
| Non-task bullets (`- note`) | Ignored for roll-up, preserved verbatim (structural notes). |
| Some children cancelled | Excluded from the denominator; rest-done ⇒ parent `done`. |
| All children cancelled | Parent derives `cancelled`. |
| Blocked child | Counted active; surfaces `blocked` to the parent. |
| Unknown status char | A character nothing claims — not the board's columns, not the published table — reads as `doing`: active, never `done`. The views mark it as unmapped rather than applying the guess silently. |
| Deeper trees | A parent sees its children's *effective* roles, not grandchildren — associative & reproducible. |

---

## 4. Manual override

A parent's state is normally derived. To close a milestone with loose ends, mark it explicitly:

```markdown
- [x] Domain + hosting [tt-override:: done] ^t-aa10
	- [ ] Set up staging box ^t-9d31
```

Why this representation (an inline **field**, not a tag or a frontmatter map):

- **Visible at the node** — a human reading raw Markdown sees "closed on purpose" weeks later.
- **Travels with the subtree** on a move (it's on the line), unlike a frontmatter map keyed by id.
- **Machine-parseable & Dataview-queryable**; `tt-`-namespaced, so no collision with Tasks/emoji.
- The value is a **role** (`done`, `cancelled`, `blocked`), stable across column renames.

Decision tree for any node's state:

1. Has `[tt-override:: R]`? → state `R`, authoritative; the plugin sets the box to R's canonical char.
2. Else has task children? → **derived** (§3).
3. Else → **leaf**; its own char is authoritative.

Dropping a parent card back into its *derived* column clears the override (returns it to derived).

---

## 4b. Dependencies (`tt-blocked-by`)

Tasks can depend on other tasks **across the tree** — the real graph, written on the line so any
agent reads it:

```markdown
- [ ] Ship the API ^t-aa10
- [ ] Announce the launch [tt-blocked-by:: t-aa10] ^t-bb20
```

- Values are **bare block ids** (no `^`), comma-separated, referencing tasks **on the same board**.
  Not wikilinks: a task's *trailing* `[[link]]` is reserved for its own task-note, and ids stay
  stable through renames where titles don't.
- An edge is **released** when the referenced task's effective role is `done` or `cancelled`; any
  other role **holds** the depending task ("waiting on dependencies").
- **Dependencies are a separate signal — they never feed roll-up (§3).** A parent's checkbox state
  stays recomputable from its own leaves alone. A held task keeps its own status character; the
  plugin surfaces the hold as a badge and in the Blockers panel. To make the *role* itself read as
  blocked, a human (or agent) writes `[tt-override:: blocked]` — explicitly, on the line.
- Unknown ids and self-references are surfaced as warnings, never dropped silently. Cycles are
  detected and flagged; they hold every task on the cycle.
- Cross-file dependencies are out of scope for now (they travel with cross-file moves, on the
  horizon).

Writers MUST preserve this field (like the override and the id) when rewriting a line's text.

---

## 4c. Task-notes (`type: task-note`)

Any task can have its **own note** — for progress, code, research, or deeper checklists. The
contract:

- A task's own note is its **trailing** `[[wikilink]]`; a link earlier in the text is an ordinary
  cross-reference. The plugin appends the link when it creates the note.
- The note's frontmatter says what the note cannot work out about itself: `type: task-note`,
  `title`, `board` (link), `parent`, `task_id`.
- **These structural keys are plugin-managed and reconciled on every board render** — no matter who
  restructured the board (the plugin, an AI agent editing the raw Markdown, or a hand edit), they
  self-heal. Hand edits to those keys are reconciled away; the note's *content* below the
  frontmatter is never touched. The `board` link is validated by resolution, so moving the board (or
  the note) between folders causes no churn.
- **`depth`, `distance_to_main` and `path` are NOT stored.** They were, and it was this document's
  own interpretation principle inverted: they are pure derivations of the board, copied into files
  the plugin does not own and kept true only by a background process. Delete the plugin and they do
  not disappear — they start lying, silently, with nothing marking them stale. (`distance_to_main`
  was also `depth` under a second name.) An agent that wants a task's depth or ancestry reads the
  board, where they are facts rather than copies. Notes still carrying them are stripped on the next
  reconcile.
- Deleting a task stamps its note (and its subtree's notes) with `task_status: orphaned` — visible
  and queryable, never destructive. If the task comes back (undo), the next reconcile clears the
  marker.

### Depth: checklists inside task-notes (read-only)

A task-note may carry **its own** `- [ ]` checklists and link to further task-notes, which may do the
same. The plugin walks that trail from each board task and reports what it finds as a badge:

- **Scope is the gate.** Only files with `type: task-note` are visited. The board itself
  (`type: task-tree`) is filtered out, which is also what stops the walk from climbing back up.
- **Bounded.** Breadth-first with a visited set (cycles and diamonds count each note once), a depth
  cap (setting, default 3 levels) and a hard note budget. A `+` on the badge means the walk stopped
  early — there is more below than the number shows.
- **Counting matches roll-up's rule**: cancelled items are excluded from the denominator.
- **Read-only, in both directions.** No board status character changes because of a note, and no
  checkbox inside a note changes because of the board. Roll-up never sees this signal — a board file
  stays recomputable from itself alone, exactly like `tt-blocked-by`.

This is what lets the board stay at the altitude a human thinks at while the real grain of the work
lives in the notes: nothing has to be flattened onto the board to be counted.

Machine-readable field tables live in [`agent/CONTRACT.md`](agent/CONTRACT.md), which is
conformance-tested against the parser.

---

## 5. Two operations, kept textually distinct

**Operation B — change state.** Exactly one status character changes:

```diff
-	- [/] Analytics wiring ^t-77e1
+	- [x] Analytics wiring ^t-77e1
```

**Operation A — restructure.** A subtree moves; children travel; ids preserved; only indentation and
order change; **no status char changes**:

```diff
-	- [/] Analytics wiring ^t-77e1
-		- [ ] GA4 events ^t-5d21
 - [ ] Instrumentation ^t-aa10
+	- [/] Analytics wiring ^t-77e1
+		- [ ] GA4 events ^t-5d21
```

Kanban drags are Operation B. Tree reparent/indent/outdent are Operation A. This separability lets an
agent diffing two versions classify each hunk as *restructure* (structure changed, chars stable) or
*state change* (one char changed, structure stable).

**Ordering caveat (Y axis).** Markdown line order encodes both priority *and* tree structure, so free
cross-parent vertical ordering can't be persisted. Task Tree persists reorder only among same-parent
siblings; within a Kanban column, order follows document order.

---

## 6. Access patterns (how the format is read & written)

Mirroring `03_DATABASE.md`'s "access patterns first":

- **Render tree** — parse `listItems` + raw lines → node tree → roll-up → draw (read-only).
- **Render board** — same model, grouped by column (flatten Z), progress on parents.
- **Operation B** — one length-preserving line edit (`vault.process`), no line shifts.
- **Operation A** — cut a contiguous `[start..lastDescendant]` range, re-indent by the depth delta,
  splice (`vault.process`), then re-derive from a fresh cache.
- **Assign ids** — one guarded batch append of `^id` to task lines lacking one.

The reference implementation of all of the above is pure and unit-tested in `src/model/` (`parser`,
`rollup`, `writer`, `ids`); see [`02_SETUP_AND_DEVELOPMENT.md`](02_SETUP_AND_DEVELOPMENT.md).

---

✅ **When this is done** the format is explicit, self-describing, and recomputable: children own the
truth, parents derive it, overrides are visible, and the same file reads correctly with or without
the plugin — for a human or an agent.
