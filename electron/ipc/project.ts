import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { CHANNELS } from "@shared/ipc/channels";

export function registerProjectHandlers() {
  // 回傳 Buffer,IPC 序列化後 renderer 拿到 Uint8Array。
  // LetterMode 用來讀 shashoku/raws/*.png 進 canvas。
  ipcMain.handle(CHANNELS.readImage, async (_e, folder: string, name: string) => {
    const p = resolve(folder, name);
    if (!p.startsWith(resolve(folder) + sep)) throw new Error("path escapes folder");
    return readFile(p);
  });
}
