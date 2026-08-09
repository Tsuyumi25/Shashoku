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
  pickFontFolder: () => ipcRenderer.invoke(CHANNELS.pickFontFolder),
  scanRoot: (rootPath) => ipcRenderer.invoke(CHANNELS.scanRoot, rootPath),
  scanLibrary: (scanPoints) => ipcRenderer.invoke(CHANNELS.scanLibrary, scanPoints),
  createProject: (rootPath) => ipcRenderer.invoke(CHANNELS.createProject, rootPath),
  createPages: (rootPath, sourceNames) =>
    ipcRenderer.invoke(CHANNELS.createPages, rootPath, sourceNames),
  openProject: (rootPath) => ipcRenderer.invoke(CHANNELS.openProject, rootPath),
  readPage: (pageDir) => ipcRenderer.invoke(CHANNELS.readPage, pageDir),
  writePage: (pageDir, input: WritePageInput) =>
    ipcRenderer.invoke(CHANNELS.writePage, pageDir, input),
  writeProjectMeta: (shashokuDir, projectMetaRaw) =>
    ipcRenderer.invoke(CHANNELS.writeProjectMeta, shashokuDir, projectMetaRaw),
  writeExport: (rootPath, profileFolder, filename, bytes) =>
    ipcRenderer.invoke(CHANNELS.writeExport, rootPath, profileFolder, filename, bytes),
  openExportFolder: (rootPath, profileFolder) =>
    ipcRenderer.invoke(CHANNELS.openExportFolder, rootPath, profileFolder),
  readImage: (folder, name) => ipcRenderer.invoke(CHANNELS.readImage, folder, name),
  readThumbnail: (key) => ipcRenderer.invoke(CHANNELS.readThumbnail, key),
  writeThumbnail: (key, bytes) => ipcRenderer.invoke(CHANNELS.writeThumbnail, key, bytes),
  readPreferences: () => ipcRenderer.invoke(CHANNELS.readPreferences),
  writePreferences: (raw) => ipcRenderer.invoke(CHANNELS.writePreferences, raw),
  windowMinimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.send(CHANNELS.windowClose),
  onWillClose: (handler) => {
    ipcRenderer.on(CHANNELS.windowWillClose, () => handler());
  },
  windowCloseReady: () => ipcRenderer.send(CHANNELS.windowCloseReady),
};

const engineApi: ShashokuEngineApi = {
  version: () => engine.engineVersion(),
  listFonts: (dirs, locales) => engine.listFonts(dirs, locales),
  uncoveredClusters: (font, text) => engine.uncoveredClusters(font, text),
  renderText: (
    font,
    text,
    sizePx,
    padding,
    rotation,
    fillColor,
    stroke,
    phaseX,
    phaseY,
    align,
    weightPx,
  ) =>
    engine.renderText(
      font,
      text,
      sizePx,
      padding,
      rotation,
      fillColor,
      stroke,
      phaseX,
      phaseY,
      align,
      weightPx,
    ),
  renderVertical: (
    font,
    text,
    sizePx,
    padding,
    rotation,
    fillColor,
    stroke,
    phaseX,
    phaseY,
    align,
    weightPx,
  ) =>
    engine.renderVertical(
      font,
      text,
      sizePx,
      padding,
      rotation,
      fillColor,
      stroke,
      phaseX,
      phaseY,
      align,
      weightPx,
    ),
  renderNotdef: (
    text,
    sizePx,
    padding,
    vertical,
    rotation,
    fillColor,
    stroke,
    phaseX,
    phaseY,
    align,
    weightPx,
  ) =>
    engine.renderNotdef(
      text,
      sizePx,
      padding,
      vertical,
      rotation,
      fillColor,
      stroke,
      phaseX,
      phaseY,
      align,
      weightPx,
    ),
  measureText: (font, text, sizePx, padding, rotation, phaseX, phaseY, align) =>
    engine.measureText(font, text, sizePx, padding, rotation, phaseX, phaseY, align),
  measureVertical: (font, text, sizePx, padding, rotation, phaseX, phaseY, align) =>
    engine.measureVertical(font, text, sizePx, padding, rotation, phaseX, phaseY, align),
  measureNotdef: (text, sizePx, padding, vertical, rotation, phaseX, phaseY, align) =>
    engine.measureNotdef(text, sizePx, padding, vertical, rotation, phaseX, phaseY, align),
  encodeImage: (rgba, width, height, input) => engine.encodeImage(rgba, width, height, input),
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("engine", engineApi);
