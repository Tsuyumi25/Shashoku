import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS as TR, type TranslateApi } from "@shared/ipc/channels";
import { CHANNELS as SSK, type OcrStatusEvent, type ShashokuApi } from "../../shared/ipc";

// 單一 window.api 同時承載兩個 mode:翻譯(ssk 工程檔 + 視窗控制)
// 與嵌字(圖片資料夾 + OCR/去字 sidecar)。
const api: TranslateApi & ShashokuApi = {
  // ── 翻譯 mode(TR = 翻譯頻道)──
  openProjectFolder: () => ipcRenderer.invoke(TR.openProjectFolder),
  listImages: (folderPath) => ipcRenderer.invoke(TR.listImages, folderPath),
  listSskFiles: (folderPath) => ipcRenderer.invoke(TR.listSskFiles, folderPath),
  readSskFile: (sskPath) => ipcRenderer.invoke(TR.readSskFile, sskPath),
  writeSskFile: (sskPath, content) => ipcRenderer.invoke(TR.writeSskFile, sskPath, content),
  saveSskAs: (defaultDir, suggestedName, content) =>
    ipcRenderer.invoke(TR.saveSskAs, defaultDir, suggestedName, content),
  openSskFile: () => ipcRenderer.invoke(TR.openSskFile),
  openHelp: () => ipcRenderer.send(TR.openHelp),
  windowMinimize: () => ipcRenderer.send(TR.windowMinimize),
  windowMaximize: () => ipcRenderer.send(TR.windowMaximize),
  windowClose: () => ipcRenderer.send(TR.windowClose),
  windowForceClose: () => ipcRenderer.send(TR.windowForceClose),
  onCloseRequested: (callback) => {
    ipcRenderer.on(TR.closeRequested, () => callback());
  },

  // ── 嵌字 mode ──
  openImageFolder: () => ipcRenderer.invoke(SSK.openImageFolder),
  readImage: (folder, name) => ipcRenderer.invoke(SSK.readImage, folder, name),
  ocrPage: (folder, name) => ipcRenderer.invoke(SSK.ocrPage, folder, name),
  inpaintBlocks: (folder, name, blocks) =>
    ipcRenderer.invoke(SSK.inpaintBlocks, folder, name, blocks),
  onOcrStatus: (cb) => {
    ipcRenderer.on(SSK.ocrStatus, (_e, ev: OcrStatusEvent) => cb(ev));
  },

  // ── 字體 mode ──
  pickFontFolder: () => ipcRenderer.invoke(SSK.pickFontFolder),
  scanFontFolder: (folder) => ipcRenderer.invoke(SSK.scanFontFolder, folder),
  listFontFolders: () => ipcRenderer.invoke(SSK.listFontFolders),
  setFontFolders: (folders) => ipcRenderer.invoke(SSK.setFontFolders, folders),
};

contextBridge.exposeInMainWorld("api", api);
