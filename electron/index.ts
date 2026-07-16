import { app } from "electron";
import { registerOcrHandlers } from "./ipc/ocr";
import { registerProjectHandlers } from "./ipc/project";
import { createWindow } from "./window";

app.whenReady().then(() => {
  registerProjectHandlers();
  registerOcrHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
