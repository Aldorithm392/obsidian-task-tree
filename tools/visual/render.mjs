// Render the tree views to PNG, in real Chromium, against the real styles.css.
//
// Obsidian is a GUI and can't run in CI or in an agent's sandbox — but its *stylesheet*
// can. These harnesses emit the exact DOM the views build, wrap it in Obsidian's CSS
// variables, and screenshot it. That turns "looks fine to me" into evidence, and it is
// how the v1.1 spacing work was actually decided (see docs/dev/VISUAL_HARNESS.md).
//
//   npm i -D playwright        # deliberately NOT a repo dependency: `npm test` stays zero-dep
//   node tools/visual/render.mjs [outDir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { diagramHtml, UNEVEN_TREE } from "./diagram.mjs";
import { listHtml, TREE } from "./list.mjs";

const OUT = resolve(process.argv[2] ?? "visual-out");
mkdirSync(OUT, { recursive: true });

// Playwright's bundled Chromium; override for a system browser.
const EXECUTABLE = process.env["CHROMIUM_PATH"] || undefined;

const DARK = `:root{
 --background-primary:#1e1e1e; --background-primary-alt:#161616; --background-secondary:#252525;
 --background-modifier-border:#3b3b3b; --background-modifier-hover:rgba(255,255,255,.06);
 --background-modifier-active-hover:rgba(255,255,255,.09);
 --text-normal:#dcddde; --text-muted:#999; --text-faint:#6e6e6e; --text-accent:#a48cff;
 --interactive-accent:#7c6cf0; --color-red:#e05252; --color-orange:#e08c3c; --color-yellow:#d9a441;}
 body{background:#1e1e1e;}`;

// The views set data-role on diagram cards; the static harness mirrors that from the chip.
const ROLE_ATTR = `(() => {
  for (const el of document.querySelectorAll(".tt-dbox")) {
    const chip = el.querySelector(":scope > .tt-node-meta > .tt-chip");
    if (chip?.dataset.role) el.setAttribute("data-role", chip.dataset.role);
  }
})();`;

const JOBS = [
	{ name: "list", html: () => listHtml(TREE), w: 780, h: 560 },
	{ name: "list-compact", html: () => listHtml(TREE), w: 780, h: 470, compact: true },
	{ name: "list-dark", html: () => listHtml(TREE), w: 780, h: 560, dark: true },
	{ name: "diagram", html: () => diagramHtml(UNEVEN_TREE), w: 1220, h: 720 },
	{ name: "diagram-inverted", html: () => diagramHtml(UNEVEN_TREE, { inverted: true }), w: 1220, h: 720 },
	{ name: "diagram-dark", html: () => diagramHtml(UNEVEN_TREE), w: 1220, h: 720, dark: true },
];

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
for (const job of JOBS) {
	const page = await browser.newPage({ viewport: { width: job.w, height: job.h } });
	await page.setContent(job.html());
	if (job.dark) await page.addStyleTag({ content: DARK });
	if (job.compact) {
		await page.evaluate(() => document.querySelector(".tt-view")?.classList.add("is-compact"));
	}
	await page.evaluate(ROLE_ATTR);
	await page.waitForTimeout(120);
	// Height of the laid-out canvas is the number the spacing work argues about — print it.
	const h = await page.evaluate(() => {
		const el = document.querySelector(".tt-diagram, .tt-root-list");
		return el ? Math.round(el.getBoundingClientRect().height) : 0;
	});
	await page.screenshot({ path: `${OUT}/${job.name}.png` });
	await page.close();
	console.log(`${job.name.padEnd(18)} content height ${h}px  ->  ${OUT}/${job.name}.png`);
}
await browser.close();
