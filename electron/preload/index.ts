import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type ShashokuApi, type WritePageInput } from "@shared/ipc/channels";

const api: ShashokuApi = {
  pickRoot: () => ipcRenderer.invoke(CHANNELS.pickRoot),
  scanRoot: (rootPath) => ipcRenderer.invoke(CHANNELS.scanRoot, rootPath),
  createProject: (rootPath) => ipcRenderer.invoke(CHANNELS.createProject, rootPath),
  importPages: (rootPath, filenames) =>
    ipcRenderer.invoke(CHANNELS.importPages, rootPath, filenames),
  openProject: (rootPath) => ipcRenderer.invoke(CHANNELS.openProject, rootPath),
  readPage: (pageDir) => ipcRenderer.invoke(CHANNELS.readPage, pageDir),
  writePage: (pageDir, input: WritePageInput) =>
    ipcRenderer.invoke(CHANNELS.writePage, pageDir, input),
  writeProjectMeta: (shashokuDir, projectMetaRaw) =>
    ipcRenderer.invoke(CHANNELS.writeProjectMeta, shashokuDir, projectMetaRaw),
  readImage: (folder, name) => ipcRenderer.invoke(CHANNELS.readImage, folder, name),
  windowMinimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.send(CHANNELS.windowClose),
};

contextBridge.exposeInMainWorld("api", api);
