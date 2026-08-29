import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Where the engine's downloaded weights go, by platform.
 *
 * Composed by hand for the same reason as `cachePath.ts`: Electron 43's
 * `app.getPath` has nothing named for this, and weights are gigabytes that
 * are not meant to be swept out like a cache.
 *
 * Computed for all three platforms so each has a real answer to test, but
 * only Windows is ever handed to the engine as `HF_HOME` — see
 * `enginePlatform.ts`.
 */
export function resolveModelHome(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(local, "Shashoku", "models");
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", "Shashoku", "models");
  }
  // The XDG spec says a relative value is invalid and must be ignored.
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".local", "share");
  return posix.join(base, "shashoku", "models");
}

export function modelHome(): string {
  return resolveModelHome(process.platform, process.env, homedir());
}
