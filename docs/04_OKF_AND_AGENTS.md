# 🕸️ Companion · OKF bundles & living with an AI agent

> **Use this for the AI-legibility story.** Where `04_GRAPH_DATABASES.md` treats relationships as
> first-class data, here a vault of boards is a **graph of Markdown concepts** an agent can read,
> traverse, and update — following the methodology of Google Cloud's **Open Knowledge Format (OKF)**.
> ↩︎ Back to the [Project Guide](PROJECT_GUIDE.md)

**Guiding principle**
> LLM-compatibility is a *property* of doing the Markdown well, not a feature and not a moat. The
> plugin's job is simply not to break it.

---

## 0. What OKF is (quick orientation)

OKF (Google Cloud, 2026) is a vendor-neutral spec for making knowledge readable by AI agents *and*
humans, as plain files:

- A **bundle** is a directory of Markdown files; each file is a **concept** = YAML frontmatter + body.
- **Required** frontmatter: `type`. **Recommended:** `title`, `description`, `resource`, `tags`,
  `timestamp`. Producers may add keys; consumers must preserve unknown keys.
- **Concept identity = file path** minus `.md` (`projects/website-redesign.md` → `projects/website-redesign`).
- Concepts link via ordinary Markdown links → an untyped directed **graph**; meaning is in the prose;
  consumers must tolerate broken links.
- Reserved files: `index.md` (a directory listing, no frontmatter) and `log.md` (dated history).

Task Tree adopts this methodology so a Task Tree vault *is* an OKF bundle with no extra work.

---

## 1. Mapping Task Tree onto OKF

| OKF concept | Task Tree |
|-------------|-----------|
| Bundle (directory) | Your vault, or a projects folder |
| Concept (one file) | One **board** = one project (`type: task-tree`) |
| Concept identity (path) | The board's path, e.g. `projects/website-redesign` |
| Sub-concept | A **task**, addressed by block id |
| Directed edge (link) | A Markdown link between tasks/boards (e.g. a dependency) |
| `index.md` / `log.md` | Optional bundle index + update log the plugin can build |

**Deliberate deviation** (announced, per the philosophy): OKF says "one concept per file," but Task
Tree keeps a whole tree in one file — the readable single-file tree *is* the product. So the concept
granularity is the **board**, and tasks are **sub-concepts** within it.

### Addressing a task
A task's global address composes OKF file identity with Obsidian's block identity:

```
projects/website-redesign.md#^t-77e1
```

A dependency between tasks is an ordinary OKF link whose meaning lives in the prose:

```markdown
- [ ] Launch checklist — blocked by [GA4 base tag](website-redesign.md#^t-5d21) ^t-9c02
```

Untyped, directed, and tolerant of breakage — exactly OKF's link model.

---

## 2. Why an agent only needs the leaves

Because **parent state is derived deterministically** (see [`03_FORMAT_SPEC.md`](03_FORMAT_SPEC.md) §3),
an agent never has to ask "should I mark this parent done?" — that question doesn't exist. It:

1. **Reads** the leaves (the atomic units of work) and recomputes any parent's state itself.
2. **Writes** only leaf states (flip a status char) and, when restructuring, moves whole branches.
3. Treats a `[tt-override:: role]` on a node as an explicit human decision to respect.
4. Follows `[tt-blocked-by:: <id>, <id>]` edges to know what a task waits on — greppable bare block
   ids, resolvable with one pass over the same file. An edge is released when its target is `done`
   or `cancelled`; edges never change roll-up, so recomputation stays per-subtree.

Everything the agent needs is in the text; nothing is hidden in the plugin.

---

## 3. Living with an agent — the one precaution

This is **documentation, not code.** The plugin does not reconcile human and agent; you do, in plain
language, in the moment.

- Freedom that's pleasant for a human (moving things freely, breaking your own rules) is what makes an
  *inconsistent* structure hard for an LLM. That's fine — it's your administration, not the project's
  problem.
- If you've overridden default behavior by hand and you connect an agent, **tell it**: "I close parent
  nodes manually — only look at the leaves," or drop a note/tag in the file. The agent is conversable;
  you don't encode the rule into the format.
- The failure mode of maximum-freedom tools isn't the freedom — it's *silent* freedom. So the contract
  is stated plainly in the README and the welcome note: **total freedom, but announced, not assumed.**

---

## 4. Building the bundle (optional helpers)

`src/model/okf.ts` includes pure builders the plugin can use:

- `buildIndexMd(entries)` → an OKF `index.md` listing your boards (a board-of-boards).
- `appendLogEntry(existing, date, entry)` → prepend a dated line to `log.md` (newest first).

These are optional niceties for a fuller bundle; the core plugin works without them. See the
[`examples/`](../examples/) folder for a minimal bundle (`index.md`, `log.md`, one project board)
that doubles as the format-validation fixture.

---

✅ **When this is done** a Task Tree vault is legible to any agent by construction: concepts are files,
tasks are addressable sub-concepts, links are a graph, and state is recomputable from the leaves —
with no AI infrastructure inside the plugin at all.
