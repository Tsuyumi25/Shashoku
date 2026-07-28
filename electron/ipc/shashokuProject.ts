


import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { CHANNELS, type WritePageInput } from "@shared/ipc/channels";
import {
  createProject,
  importPages,
  openProject,
  readPage,
  resolveExportFolder,
  scanLibrary,
  scanRoot,
  writeExport,
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

async function pickFontFolder(win: BrowserWindow | null): Promise<string | null> {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "選擇字體資料夾",
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
  ipcMain.handle(CHANNELS.pickFontFolder, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return pickFontFolder(win);
  });
  ipcMain.handle(CHANNELS.scanRoot, (_e, rootPath: string) => scanRoot(rootPath));
  ipcMain.handle(CHANNELS.scanLibrary, (_e, scanPoints: string[]) => scanLibrary(scanPoints));
  ipcMain.handle(CHANNELS.createProject, (_e, rootPath: string) => createProject(rootPath));
  ipcMain.handle(CHANNELS.importPages, (_e, rootPath: string, filenames: string[]) =>
    importPages(rootPath, filenames),
  );
  ipcMain.handle(CHANNELS.openProject, (_e, rootPath: string) => openProject(rootPath));
  ipcMain.handle(CHANNELS.readPage, (_e, pageDir: string) => readPage(pageDir));
  ipcMain.handle(CHANNELS.writePage, (_e, pageDir: string, input: WritePageInput) =>
    writePage(pageDir, input),
  );
  ipcMain.handle(CHANNELS.writeProjectMeta, (_e, shashokuDir: string, metaRaw: string) =>
    writeProjectMeta(shashokuDir, metaRaw),
  );
  ipcMain.handle(
    CHANNELS.writeExport,
    (_e, rootPath: string, profileFolder: string, filename: string, bytes: Uint8Array) =>
      writeExport(rootPath, profileFolder, filename, bytes),
  );
  // The path is composed here rather than taken whole, so the only thing the
  // renderer can ask to open is a folder belonging to a project it has open.
  ipcMain.handle(
    CHANNELS.openExportFolder,
    async (_e, rootPath: string, profileFolder: string) =>
      shell.openPath(await resolveExportFolder(rootPath, profileFolder)),
  );
}
