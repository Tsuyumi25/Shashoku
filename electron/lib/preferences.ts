import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { writeFileAtomic } from "./atomicFile";

function preferencesPath(): string {
  return join(app.getPath("userData"), "preferences.json");
}

export async function readPreferencesRaw(): Promise<string> {
  try {
    return await readFile(preferencesPath(), "utf8");
  } catch (err) {
    // A missing file is the first-run case. Anything else (unreadable, a
    // directory in its place) is a real fault the renderer should hear about
    // rather than have papered over as "no preferences yet".
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export async function writePreferencesRaw(raw: string): Promise<void> {
  await writeFileAtomic(preferencesPath(), raw);
}
