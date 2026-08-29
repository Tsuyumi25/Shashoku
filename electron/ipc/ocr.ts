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

  // Blocking, not fire-and-forget: the engine is a separate process this one
  // does not own a job object for, so letting Electron's own exit race ahead
  // of it leaves a python.exe still holding its own files open underneath the
  // very directory an update is about to overwrite. `engine.stop()` already
  // caps its own wait and force-kills past it, so the delay this adds to quit
  // is bounded, not open-ended.
  let engineStopped = false;
  app.on("before-quit", (event) => {
    if (engineStopped) return;
    event.preventDefault();
    void engine
      .stop()
      .catch(() => {})
      .then(() => {
        engineStopped = true;
        app.quit();
      });
  });
}
