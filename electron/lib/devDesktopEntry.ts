import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Desktop file ID for a development run, apart from anything a packaged build installs. */
export const DEV_DESKTOP_ID = "shashoku-dev";

/**
 * The entry a Linux desktop needs to name and draw a development run.
 *
 * A compositor finds a window's name and icon through the `.desktop` file its
 * app ID points at, and `pnpm dev` installs none — so the window either wears
 * a generic icon or gets matched to whatever entry the heuristics land on
 * first. Hidden from the app grid: it describes a running checkout, not
 * something to launch.
 */
export function devDesktopEntry(execPath: string, appPath: string): string {
  const quote = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Shashoku (dev)",
    `Icon=${join(appPath, "build", "icon.svg")}`,
    `Exec=${quote(execPath)} ${quote(appPath)}`,
    `StartupWMClass=${DEV_DESKTOP_ID}`,
    "NoDisplay=true",
    "",
  ].join("\n");
}

/**
 * Give a development run its own desktop identity. Must run before `ready`:
 * the app ID is fixed when the first window is created.
 *
 * Set explicitly rather than left to the default, because a run started from
 * inside another Electron app's terminal inherits that app's CHROME_DESKTOP.
 */
export function claimDevDesktopEntry(): void {
  if (process.platform !== "linux" || app.isPackaged) return;
  app.setDesktopName(`${DEV_DESKTOP_ID}.desktop`);

  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const dir = join(dataHome, "applications");
  const file = join(dir, `${DEV_DESKTOP_ID}.desktop`);
  const wanted = devDesktopEntry(process.execPath, app.getAppPath());
  try {
    if (readFileSync(file, "utf8") === wanted) return;
  } catch {
    // Not there yet.
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, wanted);
  } catch (err) {
    console.warn("[desktop] could not write the dev desktop entry", err);
  }
}
