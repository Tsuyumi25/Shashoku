import { dialog, ipcMain } from "electron";
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { CHANNELS, type ProjectInfo } from "../../shared/ipc";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

export function registerProjectHandlers() {
  ipcMain.handle(CHANNELS.openProjectFolder, async (): Promise<ProjectInfo | null> => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    const folder = r.filePaths[0];
    const entries = await readdir(folder, { withFileTypes: true });
    const images = entries
      .filter((e) => e.isFile() && IMAGE_EXTS.has(extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { folder, images };
  });

  // 回傳 Buffer,IPC 序列化後 renderer 拿到 Uint8Array。
  ipcMain.handle(CHANNELS.readImage, async (_e, folder: string, name: string) => {
    const p = resolve(folder, name);
    if (!p.startsWith(resolve(folder) + sep)) throw new Error("path escapes folder");
    return readFile(p);
  });
}
