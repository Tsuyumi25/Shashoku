import { app, ipcMain } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import type { OcrModel } from "@shared/ocr/types";
import { ocrSidecar } from "../lib/ocrSidecar";

export function registerOcrHandlers() {
  const engine = ocrSidecar();

  ipcMain.handle(CHANNELS.ocrModels, () => engine.models());
  ipcMain.handle(CHANNELS.ocrReadPage, (_event, imagePath: string, onomatopoeia: boolean) =>
    engine.readPage(imagePath, onomatopoeia),
  );
  ipcMain.handle(CHANNELS.ocrUnload, (_event, model: OcrModel) => engine.unload(model));
  ipcMain.handle(CHANNELS.ocrStop, () => engine.stop());

  // Best effort, and deliberately not a reason to hold up the quit: the window
  // has its own grace period to finish saving, and stealing the shutdown from
  // it to wait on a subprocess would be the wrong thing to make someone wait
  // for. What actually guarantees no engine is left behind is on the far side
  // — it watches its own stdin, which closes whatever kills this process.
  app.on("before-quit", () => {
    void engine.stop().catch(() => {});
  });
}
