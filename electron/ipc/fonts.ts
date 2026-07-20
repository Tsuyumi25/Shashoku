import { BrowserWindow, dialog, ipcMain } from "electron";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { CHANNELS, type ScannedFontFile } from "@shared/ipc/channels";
import { loadFontFolders, saveFontFolders } from "../fonts/fontconfig";
import { readFontNames } from "../fonts/sfntName";

const FONT_EXTS = new Set([".ttf", ".otf", ".ttc", ".otc"]);

export function registerFontHandlers(): void {
  ipcMain.handle(CHANNELS.pickFontFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "選擇字體資料夾",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.listFontFolders, () => loadFontFolders());

  ipcMain.handle(CHANNELS.setFontFolders, (_e, folders: string[]) => {
    saveFontFolders(folders.filter((f) => typeof f === "string"));
  });

  ipcMain.handle(
    CHANNELS.scanFontFolder,
    async (_e, folder: string): Promise<ScannedFontFile[]> => {
      let entries: string[];
      try {
        entries = await readdir(folder);
      } catch {
        return []; // 資料夾消失(外接碟拔掉等):靜默回空,由 UI 呈現數量
      }
      const out: ScannedFontFile[] = [];
      for (const name of entries.sort()) {
        if (!FONT_EXTS.has(extname(name).toLowerCase())) continue;
        const path = join(folder, name);
        try {
          const faces = await readFontNames(path);
          if (faces.length) out.push({ path, faces });
        } catch {
          // 單一壞檔不該讓整次掃描失敗
        }
      }
      return out;
    },
  );
}
