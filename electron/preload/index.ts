import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type OcrStatusEvent, type ShashokuApi } from "@shared/ipc/channels";

// 單一 window.api:翻譯 + 嵌字 + 字體 + 視窗控制。
const api: ShashokuApi = {
  // ── 專案(翻譯 mode) ──
  openProjectFolder: () => ipcRenderer.invoke(CHANNELS.openProjectFolder),
  listImages: (folderPath) => ipcRenderer.invoke(CHANNELS.listImages, folderPath),
  listSskFiles: (folderPath) => ipcRenderer.invoke(CHANNELS.listSskFiles, folderPath),
  readSskFile: (sskPath) => ipcRenderer.invoke(CHANNELS.readSskFile, sskPath),
  writeSskFile: (sskPath, content) => ipcRenderer.invoke(CHANNELS.writeSskFile, sskPath, content),
  saveSskAs: (defaultDir, suggestedName, content) =>
    ipcRenderer.invoke(CHANNELS.saveSskAs, defaultDir, suggestedName, content),
  openSskFile: () => ipcRenderer.invoke(CHANNELS.openSskFile),

  // ── 圖片 / OCR / 去字(嵌字 mode) ──
  openImageFolder: () => ipcRenderer.invoke(CHANNELS.openImageFolder),
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
