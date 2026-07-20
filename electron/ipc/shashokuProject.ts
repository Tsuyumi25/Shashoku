// Shashoku 專案(新架構)的 IPC binding。純 handler 註冊,實際 fs 邏輯在
// electron/lib/projectFs.ts(方便單元測試,不需要 mock electron)。

import { BrowserWindow, dialog, ipcMain } from "electron";
import { CHANNELS, type WritePageInput } from "@shared/ipc/channels";
import {
  createProject,
  openProject,
  readPage,
  scanRoot,
  writePage,
  writeProjectMeta,
} from "../lib/projectFs";

async function pickRoot(win: BrowserWindow | null): Promise<string | null> {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "選擇專案資料夾(內含原圖)",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

export function registerShashokuProjectHandlers(): void {
  ipcMain.handle(CHANNELS.pickRoot, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return pickRoot(win);
  });
  ipcMain.handle(CHANNELS.scanRoot, (_e, rootPath: string) => scanRoot(rootPath));
  ipcMain.handle(CHANNELS.createProject, (_e, rootPath: string) => createProject(rootPath));
  ipcMain.handle(CHANNELS.openProject, (_e, rootPath: string) => openProject(rootPath));
  ipcMain.handle(CHANNELS.readPage, (_e, pageDir: string) => readPage(pageDir));
  ipcMain.handle(CHANNELS.writePage, (_e, pageDir: string, input: WritePageInput) =>
    writePage(pageDir, input),
  );
  ipcMain.handle(CHANNELS.writeProjectMeta, (_e, shashokuDir: string, metaRaw: string) =>
    writeProjectMeta(shashokuDir, metaRaw),
  );
}
