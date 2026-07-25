import { contextBridge, ipcRenderer } from "electron";
import type { ShashokuEngineApi } from "@shared/engine/types";
import { CHANNELS, type ShashokuApi, type WritePageInput } from "@shared/ipc/channels";

// The addon is required here rather than reached through IPC: a sample render
// costs well under a millisecond, so a round trip per grid cell would dominate
// the work it is waiting on. Declared by hand instead of importing the
// generated index.d.ts, which only exists after `pnpm engine:build` and would
// otherwise make typecheck depend on build order.
type EngineAddon = Omit<ShashokuEngineApi, "version"> & { engineVersion(): string };

const engine = require("@shashoku/engine") as EngineAddon;

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
  readPreferences: () => ipcRenderer.invoke(CHANNELS.readPreferences),
  writePreferences: (raw) => ipcRenderer.invoke(CHANNELS.writePreferences, raw),
  windowMinimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.send(CHANNELS.windowClose),
};

const engineApi: ShashokuEngineApi = {
  version: () => engine.engineVersion(),
  listFonts: (dirs, locales) => engine.listFonts(dirs, locales),
  uncoveredClusters: (font, text) => engine.uncoveredClusters(font, text),
  renderText: (font, text, sizePx, padding, fillColor, stroke) =>
    engine.renderText(font, text, sizePx, padding, fillColor, stroke),
  renderVertical: (font, text, sizePx, padding, fillColor, stroke) =>
    engine.renderVertical(font, text, sizePx, padding, fillColor, stroke),
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("engine", engineApi);
