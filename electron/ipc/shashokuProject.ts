


import { BrowserWindow, dialog, ipcMain } from "electron";
import { CHANNELS, type WritePageInput } from "@shared/ipc/channels";
import {
  createProject,
  importPages,
  openProject,
  readPage,
  scanLibrary,
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

async function pickFontFolder(win: BrowserWindow | null): Promise<string | null> {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "選擇字體資料夾",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

/**
 * Its own picker rather than pickRoot's, because it asks for a different kind
 * of folder: one that already holds projects, which nothing here will write to.
 */
async function pickLibraryFolder(win: BrowserWindow | null): Promise<string | null> {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "選擇含有專案的資料夾",
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
  ipcMain.handle(CHANNELS.pickLibraryFolder, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return pickLibraryFolder(win);
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
}
