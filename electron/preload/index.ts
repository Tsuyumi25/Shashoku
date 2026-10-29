import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { EngineSpan, ShashokuEngineApi } from "@shared/engine/types";
import type { ShashokuInpaintApi } from "@shared/inpaint/types";
import type { OcrProgress, OcrStatus, ShashokuOcrApi } from "@shared/ocr/types";
import { CHANNELS, type ShashokuApi, type WritePageInput } from "@shared/ipc/channels";

// The addon is required here rather than reached through IPC: a sample render
// costs well under a millisecond, so a round trip per grid cell would dominate
// the work it is waiting on. Declared by hand instead of importing the
// generated index.d.ts, which only exists after `pnpm engine:build` and would
// otherwise make typecheck depend on build order.
type EngineAddon = Omit<ShashokuEngineApi, "version"> & { engineVersion(): string };

const engine = require("@shashoku/engine") as EngineAddon;

// Copied rather than passed through, the same reason `strokeLayer` copies: the
// list comes off a Vue store, and structured clone refuses a Proxy with
// nothing said but "an object could not be cloned".
const plainSpans = (spans?: EngineSpan[]) =>
  spans?.map((s) => ({
    start: s.start,
    end: s.end,
    sizePx: s.sizePx,
    color: s.color,
    weightPx: s.weightPx,
    upright: s.upright,
  }));

const api: ShashokuApi = {
  pickRoot: () => ipcRenderer.invoke(CHANNELS.pickRoot),
  pickWorkspace: () => ipcRenderer.invoke(CHANNELS.pickWorkspace),
  pickFontFolder: () => ipcRenderer.invoke(CHANNELS.pickFontFolder),
  scanRoot: (rootPath) => ipcRenderer.invoke(CHANNELS.scanRoot, rootPath),
  scanLibrary: (scanPoints) => ipcRenderer.invoke(CHANNELS.scanLibrary, scanPoints),
  scanWorkspaces: (roots) => ipcRenderer.invoke(CHANNELS.scanWorkspaces, roots),
  listInside: (path) => ipcRenderer.invoke(CHANNELS.listInside, path),
  describeFolders: (paths) => ipcRenderer.invoke(CHANNELS.describeFolders, paths),
  createProject: (rootPath) => ipcRenderer.invoke(CHANNELS.createProject, rootPath),
  createPage: (rootPath, sourceName) =>
    ipcRenderer.invoke(CHANNELS.createPage, rootPath, sourceName),
  openProject: (rootPath) => ipcRenderer.invoke(CHANNELS.openProject, rootPath),
  readProjectMeta: (rootPath) => ipcRenderer.invoke(CHANNELS.readProjectMeta, rootPath),
  readPage: (pageDir) => ipcRenderer.invoke(CHANNELS.readPage, pageDir),
  writePage: (pageDir, input: WritePageInput) =>
    ipcRenderer.invoke(CHANNELS.writePage, pageDir, input),
  deleteLayerParts: (pageDir, filenames) =>
    ipcRenderer.invoke(CHANNELS.deleteLayerParts, pageDir, filenames),
  writeProjectMeta: (shashokuDir, projectMetaRaw) =>
    ipcRenderer.invoke(CHANNELS.writeProjectMeta, shashokuDir, projectMetaRaw),
  writeExport: (rootPath, profileFolder, filename, bytes) =>
    ipcRenderer.invoke(CHANNELS.writeExport, rootPath, profileFolder, filename, bytes),
  openExportFolder: (rootPath, profileFolder) =>
    ipcRenderer.invoke(CHANNELS.openExportFolder, rootPath, profileFolder),
  openProjectFolder: (rootPath) => ipcRenderer.invoke(CHANNELS.openProjectFolder, rootPath),
  readImage: (folder, name) => ipcRenderer.invoke(CHANNELS.readImage, folder, name),
  readThumbnail: (key) => ipcRenderer.invoke(CHANNELS.readThumbnail, key),
  writeThumbnail: (key, bytes) => ipcRenderer.invoke(CHANNELS.writeThumbnail, key, bytes),
  readPreferences: () => ipcRenderer.invoke(CHANNELS.readPreferences),
  writePreferences: (raw) => ipcRenderer.invoke(CHANNELS.writePreferences, raw),
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  windowSetOverlay: (color, symbolColor) =>
    ipcRenderer.send(CHANNELS.windowSetOverlay, color, symbolColor),
  onWillClose: (handler) => {
    ipcRenderer.on(CHANNELS.windowWillClose, () => handler());
  },
  windowCloseReady: () => ipcRenderer.send(CHANNELS.windowCloseReady),
  windowCloseBusy: () => ipcRenderer.send(CHANNELS.windowCloseBusy),
  windowCloseFailed: () => ipcRenderer.invoke(CHANNELS.windowCloseFailed),
  onMcpQuery: (handler) => {
    ipcRenderer.on(CHANNELS.mcpQuery, (_e, query) => handler(query));
  },
  mcpReply: (reply) => ipcRenderer.send(CHANNELS.mcpReply, reply),
  mcpReady: () => ipcRenderer.send(CHANNELS.mcpReady),
  wallOpen: () => ipcRenderer.send(CHANNELS.wallOpen),
  onWallState: (handler) => {
    ipcRenderer.on(CHANNELS.wallState, (_e, open: boolean) => handler(open));
  },
  wallPublish: (scene) => ipcRenderer.send(CHANNELS.wallScene, scene),
  onWallSceneWanted: (handler) => {
    ipcRenderer.on(CHANNELS.wallSceneWanted, () => handler());
  },
  onWallReveal: (handler) => {
    ipcRenderer.on(CHANNELS.wallReveal, (_e, pageId: string, id: string) => handler(pageId, id));
  },
  wallWantScene: () => ipcRenderer.send(CHANNELS.wallSceneWanted),
  onWallScene: (handler) => {
    ipcRenderer.on(CHANNELS.wallScene, (_e, scene) => handler(scene));
  },
  wallReveal: (pageId, id) => ipcRenderer.send(CHANNELS.wallReveal, pageId, id),
  wallSelect: (ids) => ipcRenderer.send(CHANNELS.wallSelect, ids),
  onWallSelect: (handler) => {
    ipcRenderer.on(CHANNELS.wallSelect, (_e, ids: string[]) => handler(ids));
  },
  wallPublishSelection: (ids) => ipcRenderer.send(CHANNELS.wallSelection, ids),
  onWallSelection: (handler) => {
    ipcRenderer.on(CHANNELS.wallSelection, (_e, ids: string[]) => handler(ids));
  },
  wallBrush: (tags) => ipcRenderer.send(CHANNELS.wallBrush, tags),
  onWallBrush: (handler) => {
    ipcRenderer.on(CHANNELS.wallBrush, (_e, tags: string[]) => handler(tags));
  },
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
    spans,
    scaleX,
    scaleY,
    leading,
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
      plainSpans(spans),
      scaleX,
      scaleY,
      leading,
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
    spans,
    scaleX,
    scaleY,
    leading,
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
      plainSpans(spans),
      scaleX,
      scaleY,
      leading,
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
  measureText: (
    font,
    text,
    sizePx,
    padding,
    rotation,
    phaseX,
    phaseY,
    align,
    spans,
    scaleX,
    scaleY,
    leading,
  ) =>
    engine.measureText(
      font,
      text,
      sizePx,
      padding,
      rotation,
      phaseX,
      phaseY,
      align,
      plainSpans(spans),
      scaleX,
      scaleY,
      leading,
    ),
  measureVertical: (
    font,
    text,
    sizePx,
    padding,
    rotation,
    phaseX,
    phaseY,
    align,
    spans,
    scaleX,
    scaleY,
    leading,
  ) =>
    engine.measureVertical(
      font,
      text,
      sizePx,
      padding,
      rotation,
      phaseX,
      phaseY,
      align,
      plainSpans(spans),
      scaleX,
      scaleY,
      leading,
    ),
  measureNotdef: (text, sizePx, padding, vertical, rotation, phaseX, phaseY, align) =>
    engine.measureNotdef(text, sizePx, padding, vertical, rotation, phaseX, phaseY, align),
  encodeImage: (rgba, width, height, input) => engine.encodeImage(rgba, width, height, input),
  // Copied rather than passed through: the list comes off a Vue store, and
  // structured clone refuses a Proxy with nothing said but "an object could not
  // be cloned".
  strokeLayer: (rgba, width, height, strokes) =>
    engine.strokeLayer(
      rgba,
      width,
      height,
      strokes.map((s) => ({ width: s.width, color: s.color, position: s.position })),
    ),
  rasterTake: (id, rgba, frame) => engine.rasterTake(id, rgba, frame),
  rasterHolds: (id) => engine.rasterHolds(id),
  rasterRelease: (id) => engine.rasterRelease(id),
  rasterReleaseAll: () => engine.rasterReleaseAll(),
  rasterFill: (id, mask, maskFrame, color, alphaLocked) =>
    engine.rasterFill(id, mask, maskFrame, color, alphaLocked),
  rasterPaste: (id, rgba, mask, maskFrame, alphaLocked) =>
    engine.rasterPaste(id, rgba, mask, maskFrame, alphaLocked),
  rasterErase: (id, mask, maskFrame) => engine.rasterErase(id, mask, maskFrame),
  rasterRead: (id, region) => engine.rasterRead(id, region),
  rasterApplyJournal: (journal) => engine.rasterApplyJournal(journal),
  rasterDropJournal: (journal) => engine.rasterDropJournal(journal),
  rasterHistoryBytes: () => engine.rasterHistoryBytes(),
  rasterTrimHistory: (floor, ceiling) => engine.rasterTrimHistory(floor, ceiling),
  maskState: () => engine.maskState(),
  maskRead: (region) => engine.maskRead(region),
  maskHold: (page, width, height) => engine.maskHold(page, width, height),
  maskDeselect: () => engine.maskDeselect(),
  maskWrite: (region, bytes) => engine.maskWrite(region, bytes),
  maskSelectAll: () => engine.maskSelectAll(),
  maskInvert: () => engine.maskInvert(),
  maskGrow: (pixels) => engine.maskGrow(pixels),
  maskApplyJournal: (journal) => engine.maskApplyJournal(journal),
  maskDropJournal: (journal) => engine.maskDropJournal(journal),
  maskAbsorbJournal: (into, later) => engine.maskAbsorbJournal(into, later),
  maskBytesHeld: () => engine.maskBytesHeld(),
  maskReset: () => engine.maskReset(),
};

// ────────────────────────────────────────────────────────────────────────────
// OCR
//
// Reached over IPC rather than required here, unlike the text engine above.
// The models live in a process of their own, so there is no addon to hold — and
// the round trip that would have dominated a sample render is nothing beside an
// inference measured in hundreds of milliseconds.

const ocrApi: ShashokuOcrApi = {
  models: () => ipcRenderer.invoke(CHANNELS.ocrModels),
  readPage: (imagePath, onomatopoeia) =>
    ipcRenderer.invoke(CHANNELS.ocrReadPage, imagePath, onomatopoeia),
  unload: (model) => ipcRenderer.invoke(CHANNELS.ocrUnload, model),
  stop: () => ipcRenderer.invoke(CHANNELS.ocrStop),
  onStatus: (handler) => {
    ipcRenderer.on(CHANNELS.ocrStatus, (_event, status: OcrStatus) => handler(status));
  },
  onProgress: (handler) => {
    ipcRenderer.on(CHANNELS.ocrProgress, (_event, progress: OcrProgress) => handler(progress));
  },
};

const inpaintApi: ShashokuInpaintApi = {
  erase: (request) => ipcRenderer.invoke(CHANNELS.inpaintErase, request),
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("engine", engineApi);
contextBridge.exposeInMainWorld("ocr", ocrApi);
contextBridge.exposeInMainWorld("inpaint", inpaintApi);
