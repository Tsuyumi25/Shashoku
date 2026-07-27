import { mkdir, readFile } from "node:fs/promises";
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
