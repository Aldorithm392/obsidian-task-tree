# Visual harness — seeing the views without Obsidian

Obsidian is a GUI. It can't run in CI, and it can't run in an agent's sandbox — which
has meant every layout decision in this repo was argued from memory. It doesn't have to
be. Obsidian's *stylesheet* is just CSS, and its theme surface is a set of CSS variables.

`tools/visual/` emits the exact DOM the views build, wraps it in those variables, loads
the real `styles.css`, and screenshots it in headless Chromium. Layout claims become
measurements.

```bash
npm i -D playwright          # NOT a repo dependency — `npm test` stays zero-dep
npx playwright install chromium
node tools/visual/render.mjs [outDir]     # default: ./visual-out
# CHROMIUM_PATH=/path/to/chrome node tools/visual/render.mjs   # use a system browser
```

It renders the list and diagram layouts in light, dark and Compact, prints the laid-out
content height of each, and writes a PNG per variant. The `diagram-folded` job renders at
`openDepth: 2` — what a board actually opens as — while plain `diagram` stays fully expanded,
because the packing and geometry questions are about the widest case.

**The fixtures must not flatter the plugin.** Every parent in them carries a `K/D`, because
`createProgressBadge` emits one whenever `progress.total > 0` — i.e. always, for a node with task
children. Two fixture parents were missing theirs; harmless while everything rendered expanded, and
a dead end the moment folding shipped, since the fraction on a folded parent *is* the branch. The
diagram's progress bar was likewise hard-coded to `width:50%` next to whatever fraction it printed.
An instrument that disagrees with the thing it measures is worse than no instrument.

## What it is not

The harness renders **static DOM**, not the plugin. It proves things about CSS: spacing,
hierarchy, wrapping, theme behaviour, and the geometry the overlay code computes. It
proves nothing about event handlers, the metadata cache, or write-back — those still need
a real vault and `docs/dev/QA_CHECKLIST.md`. Keep the fixtures in `diagram.mjs` / `list.mjs`
in step with `buildRowContent()` when the row markup changes, or you'll be measuring a
layout the plugin no longer emits.

## Two things it already caught

**The inverted diagram drew its dependency edges in the wrong place.** `drawDependencyEdges`
measured with `getBoundingClientRect()` — screen coordinates — and drew into an SVG that
lives *inside* the canvas's `transform: scaleX(-1)`. A probe showed SVG-local `x=0` landing
at the canvas's right edge, and a rendered edge terminating in empty space instead of on
its target task. Fixed by measuring with the offset chain (`localRect`), which is
pre-transform and therefore correct in both orientations.

**The reported "diagram spacing" complaint was misdiagnosed.** The suspicion was that
`align-items: center` created the gaps. Measured:

| variant | canvas height | worst sibling gap |
|---|---|---|
| `center` (shipped) | 460px | 98px |
| `flex-start` | **460px** | **116px** |
| `flex-start`, gap 4px | 420px | 104px |

Alignment changes nothing — the height is *leaf-bound*, `leaves × (row + gap)`, already
optimal for this layout family; `flex-start` just pools the whitespace at the bottom and
makes the worst gap worse. Only the row gap moves the number at all. The visible "gap" is
a parent box centred against a tall subtree, which is inherent to a layered tree. A
genuinely tighter one needs contour-based packing (Reingold–Tilford) — tracked in
`ROADMAP.md`, not faked with a CSS tweak.

That measurement also redirected the work: the view's problem was never that it was too
loose, it was that it was too **tight**. Which is what the density pass fixed.
