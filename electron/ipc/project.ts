import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { CHANNELS } from "@shared/ipc/channels";

export function registerProjectHandlers() {
  ipcMain.handle(CHANNELS.readImage, async (_e, folder: string, name: string) => {
    const p = resolve(folder, name);
    if (!p.startsWith(resolve(folder) + sep)) throw new Error("path escapes folder");
    return readFile(p);
  });
}
