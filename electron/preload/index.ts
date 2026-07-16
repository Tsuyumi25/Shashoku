import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type OcrStatusEvent, type ShashokuApi } from "../../shared/ipc";

const api: ShashokuApi = {
  openProjectFolder: () => ipcRenderer.invoke(CHANNELS.openProjectFolder),
  readImage: (folder, name) => ipcRenderer.invoke(CHANNELS.readImage, folder, name),
  ocrPage: (folder, name) => ipcRenderer.invoke(CHANNELS.ocrPage, folder, name),
  inpaintBlocks: (folder, name, blocks) =>
    ipcRenderer.invoke(CHANNELS.inpaintBlocks, folder, name, blocks),
  onOcrStatus: (cb) => {
    ipcRenderer.on(CHANNELS.ocrStatus, (_e, ev: OcrStatusEvent) => cb(ev));
  },
};

contextBridge.exposeInMainWorld("api", api);
