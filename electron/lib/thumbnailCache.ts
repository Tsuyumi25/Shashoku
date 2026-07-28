import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { thumbnailCacheDir } from "./cachePath";
import { writeFileAtomic } from "./atomicFile";

/**
 * The renderer decides what a thumbnail is a thumbnail of and hands the answer
 * over as a hash, so the key is the whole filename and there is nothing left in
 * it to escape with. Anything else is refused rather than sanitized: a caller
 * passing something else has a bug, and quietly renaming it would hide it.
 */
const KEY = /^[0-9a-f]{64}$/;

function fileFor(key: string): string {
  if (!KEY.test(key)) throw new Error(`thumbnail key must be a sha-256 hex digest: ${key}`);
  return join(thumbnailCacheDir(), `${key}.png`);
}

export async function readThumbnail(key: string): Promise<Uint8Array | null> {
  try {
    return await readFile(fileFor(key));
  } catch {
    // A cache that will not read is a cache miss, which the caller already
    // knows how to answer.
    return null;
  }
}

export async function writeThumbnail(key: string, bytes: Uint8Array): Promise<void> {
  const path = fileFor(key);
  await mkdir(thumbnailCacheDir(), { recursive: true });
  await writeFileAtomic(path, bytes);
}

/**
 * What the thumbnails may take up between them. Retyping a page changes its
 * key, so the file the new one replaces is dead on arrival and nothing will
 * ask for it again — left alone the directory records every intermediate
 * state a chapter passed through on its way to being finished.
 *
 * Stated in bytes rather than in days: what this costs is disk, and an age
 * that comfortably covered a quiet week would let a busy one run away.
 */
export const THUMBNAIL_BUDGET_BYTES = 256 * 1024 * 1024;

export interface CachedFile {
  name: string;
  size: number;
  writtenAt: number;
}

/**
 * The files to let go of, newest kept. Everything here is regenerable, so
 * dropping one costs a redraw and nothing else — which is why the cheapest
 * ordering is good enough: a read leaves no mark to sort by, atime being off
 * or coarse on most mounts, so how recently something was written stands in
 * for how likely it is to be wanted.
 */
export function overBudget(files: readonly CachedFile[], budget: number): string[] {
  const newestFirst = [...files].sort(
    (a, b) => b.writtenAt - a.writtenAt || a.name.localeCompare(b.name),
  );
  const doomed: string[] = [];
  let kept = 0;
  for (const file of newestFirst) {
    kept += file.size;
    if (kept > budget) doomed.push(file.name);
  }
  return doomed;
}

/**
 * Brings the cache back inside its budget. Called once at startup rather than
 * after each write: a sweep is a directory walk, and the size it is guarding
 * against takes a whole session's work to reach.
 */
export async function sweepThumbnails(budget = THUMBNAIL_BUDGET_BYTES): Promise<void> {
  const dir = thumbnailCacheDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // Nothing cached yet, which is inside any budget there is.
    return;
  }

  const measured = await Promise.all(
    names.map(async (name): Promise<CachedFile | null> => {
      try {
        const info = await stat(join(dir, name));
        return info.isFile() ? { name, size: info.size, writtenAt: info.mtimeMs } : null;
      } catch {
        // Something else swept it between the listing and the stat.
        return null;
      }
    }),
  );
  const files = measured.filter((f): f is CachedFile => f !== null);

  await Promise.all(
    overBudget(files, budget).map((name) => rm(join(dir, name), { force: true })),
  );
}
