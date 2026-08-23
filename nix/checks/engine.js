/*
 * Whether Node can load the addon at all.
 *
 * The crate's own tests run inside its build and say nothing about this: N-API
 * has one answer per built addon, and it is not a question about the code.
 * Resolved through the package's manifest rather than by path, so the entry
 * this derivation writes is under test too.
 */

const engine = require(process.env.SHASHOKU_ENGINE);

const version = engine.engineVersion();
if (typeof version !== "string" || !version) {
  throw new Error(`engineVersion() answered ${version}`);
}

for (const name of ["measureText", "rasterPaste", "maskGrow", "listFonts"]) {
  if (typeof engine[name] !== "function") {
    throw new Error(`${name} did not come through`);
  }
}
