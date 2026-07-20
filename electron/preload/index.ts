import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type OcrStatusEvent, type ShashokuApi } from "@shared/ipc/channels";

// 單一 window.api:翻譯 + 嵌字 + 字體 + 視窗控制。
const api: ShashokuApi = {
  // ── Shashoku 專案 ──
  pickRoot: () => ipcRenderer.invoke(CHANNELS.pickRoot),
  scanRoot: (rootPath) => ipcRenderer.invoke(CHANNELS.scanRoot, rootPath),
  createProject: (rootPath) => ipcRenderer.invoke(CHANNELS.createProject, rootPath),
  importPages: (rootPath, filenames) => ipcRenderer.invoke(CHANNELS.importPages, rootPath, filenames),
  openProject: (rootPath) => ipcRenderer.invoke(CHANNELS.openProject, rootPath),
  readPage: (pageDir) => ipcRenderer.invoke(CHANNELS.readPage, pageDir),
  writePage: (pageDir, input) => ipcRenderer.invoke(CHANNELS.writePage, pageDir, input),
  writeProjectMeta: (shashokuDir, metaRaw) =>
    ipcRenderer.invoke(CHANNELS.writeProjectMeta, shashokuDir, metaRaw),

  // ── 圖片 / OCR / 去字 ──
  readImage: (folder, name) => ipcRenderer.invoke(CHANNELS.readImage, folder, name),
  ocrPage: (folder, name) => ipcRenderer.invoke(CHANNELS.ocrPage, folder, name),
  inpaintBlocks: (folder, name, blocks) =>
    ipcRenderer.invoke(CHANNELS.inpaintBlocks, folder, name, blocks),
  onOcrStatus: (cb) => {
    ipcRenderer.on(CHANNELS.ocrStatus, (_e, ev: OcrStatusEvent) => cb(ev));
  },

  // ── 字體 ──
  pickFontFolder: () => ipcRenderer.invoke(CHANNELS.pickFontFolder),
  scanFontFolder: (folder) => ipcRenderer.invoke(CHANNELS.scanFontFolder, folder),
  listFontFolders: () => ipcRenderer.invoke(CHANNELS.listFontFolders),
  setFontFolders: (folders) => ipcRenderer.invoke(CHANNELS.setFontFolders, folders),

  // ── app / 視窗 ──
  openHelp: () => ipcRenderer.send(CHANNELS.openHelp),
  windowMinimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.send(CHANNELS.windowClose),
  windowForceClose: () => ipcRenderer.send(CHANNELS.windowForceClose),
  openTextBoard: () => ipcRenderer.send(CHANNELS.openTextBoard),
  onCloseRequested: (callback) => {
    ipcRenderer.on(CHANNELS.closeRequested, () => callback());
  },
};

contextBridge.exposeInMainWorld("api", api);
