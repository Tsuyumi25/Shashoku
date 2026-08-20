/**
 * One function of Node's, for the tests that drive the real engine.
 *
 * The selection's coverage lives in the engine's tiles, so a test of the
 * selection store either loads the addon or invents a second implementation of
 * the invariants the tiles exist to keep — and a stand-in that agreed with the
 * store and disagreed with the engine would pass while the application was
 * broken. So the tests require the addon the same way preload does.
 *
 * Named here rather than by adding node types to the renderer project, which
 * carries none on purpose: renderer source that could reach a filesystem is
 * renderer source that will. This declares the one function needed to reach a
 * CommonJS addon from an ES module and nothing else.
 */
declare module "node:module" {
  export function createRequire(from: string): (id: string) => unknown;
}
