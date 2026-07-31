# Example bundle

A minimal **OKF bundle** and Task Tree demo. Open this folder as an Obsidian vault (or copy
`projects/website-redesign.md` into your own vault) to try the plugin, and see
[`../docs/03_FORMAT_SPEC.md`](../docs/03_FORMAT_SPEC.md) for the format.

- `index.md` — OKF directory listing (no frontmatter).
- `log.md` — OKF dated update log.
- `projects/website-redesign.md` — a worked board: a `Doing` parent with a `1/2` roll-up, a `Blocked`
  branch that surfaces to its parent, a **cancelled** child that drops out of its parent's
  denominator rather than holding the milestone open, a manually **overridden** `Done` milestone
  with an unfinished child, and a non-task note that the roll-up ignores.

It declares **no** `tt_columns`, on purpose. Every character in it — `" "`, `/`, `x`, `!`, `-` — is
published, so the board means the same thing on any machine without announcing anything. A board
only has to declare its columns when it gives a character a *different* meaning; the plugin writes
that declaration itself, once, when it happens.

This board doubles as the parser/roll-up fixture referenced by the format-validation check.
