import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

/**
 * Where regenerable files go.
 *
 * Composed by hand because Electron 43's app.getPath takes no "cache" name —
 * it offers userData and temp, and neither is right: userData is backed up and
 * synced, and a page thumbnail is invalidated by every re-typeset, so putting
 * them there would make the profile churn forever. temp is swept out from
 * under a running application.
 *
 * Kept out of the project folder for the same reason: a layer file is written
 * once and never rewritten, while finished-page thumbnails are redrawn on every
 * edit, and a project folder is something people sync and hand to each other.
 */
export function resolveCacheRoot(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  // The platform asked about decides the separator, not the one this is
  // running on — otherwise the answer is only ever right at home.
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(local, "shashoku", "Cache");
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Caches", "shashoku");
  }
  // The XDG spec says a relative value is invalid and must be ignored.
  const xdg = env.XDG_CACHE_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".cache");
  return posix.join(base, "shashoku");
}

export function cacheRoot(): string {
  return resolveCacheRoot(process.platform, process.env, homedir());
}

export function thumbnailCacheDir(): string {
  return join(cacheRoot(), "thumbnails");
}
