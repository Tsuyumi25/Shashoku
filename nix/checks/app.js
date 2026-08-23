/*
 * What assembling adds over the two derivations it joins.
 *
 * That the bundles ask nothing of the outside is settled while they are built,
 * so it is not asked again here. What is left is whether the layout around them
 * holds: the files the manifest names, and the addon reached the way the code
 * reaches it.
 */

const fs = require("node:fs");
const { createRequire } = require("node:module");

const root = process.env.SHASHOKU_APP_ROOT;

const manifest = JSON.parse(fs.readFileSync(`${root}/package.json`, "utf8"));
const entry = `${root}/${manifest.main}`;
const preload = `${root}/out/preload/index.cjs`;

for (const path of [entry, preload, `${root}/out/renderer/index.html`]) {
  if (!fs.existsSync(path)) {
    throw new Error(`missing ${path}`);
  }
}

// Resolved from preload, which is the file that does the requiring: Node walks
// up from there, so where the package is linked in is what decides whether it
// is found at all.
const engine = createRequire(preload)("@shashoku/engine");
if (typeof engine.engineVersion() !== "string") {
  throw new Error("the addon resolved but did not answer");
}
