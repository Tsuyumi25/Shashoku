import { createRequire } from "node:module";

/**
 * The native engine, as the main process reaches it.
 *
 * Required rather than imported, and lazily: a `.node` binary is not something
 * the bundler can follow, and holding off until the first call keeps anything
 * that only wants the pure helpers next door from needing a built addon.
 *
 * Declared by hand instead of importing the generated index.d.ts, which only
 * exists after `pnpm engine:build` and would otherwise make typecheck depend on
 * build order — the same reason preload declares its own.
 */
interface EngineAddon {
  importBaseMap(
    sourcePath: string,
    destPath: string,
  ): Promise<{ width: number; height: number }>;
}

let addon: EngineAddon | null = null;

function engine(): EngineAddon {
  addon ??= createRequire(import.meta.url)("@shashoku/engine") as EngineAddon;
  return addon;
}

/**
 * Copies a source image into a page as its base map — a PNG of the same pixels,
 * decoded once and never again — and answers with the size the page therefore
 * has.
 *
 * Two paths and no buffer, so the pixels never enter a JavaScript heap. Refuses
 * a source whose bytes are not really on this machine and one that stops before
 * its format's end marker, either of which would otherwise decode into a page
 * that is quietly half grey.
 */
export function importBaseMap(
  sourcePath: string,
  destPath: string,
): Promise<{ width: number; height: number }> {
  return engine().importBaseMap(sourcePath, destPath);
}
