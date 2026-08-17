import { app, BrowserWindow, Menu } from "electron";
import { createWindow } from "./window";
import { registerOcrHandlers } from "./ipc/ocr";
import { registerPreferencesHandlers } from "./ipc/preferences";
import { registerProjectHandlers } from "./ipc/project";
import { registerShashokuProjectHandlers } from "./ipc/shashokuProject";
import { registerWindowHandlers } from "./ipc/window";
import { registerMcpBridge } from "./mcp/bridge";
import { startMcpServer } from "./mcp/server";
import { sweepThumbnails } from "./lib/thumbnailCache";

let mainWindow: BrowserWindow | null = null;

Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  registerOcrHandlers();
  registerPreferencesHandlers();
  registerProjectHandlers();
  registerShashokuProjectHandlers();
  registerWindowHandlers();
  registerMcpBridge(() => mainWindow);
  startMcpServer();
  mainWindow = createWindow();
  mainWindow.once("closed", () => {
    mainWindow = null;
  });

  // Left unawaited and after the window: reclaiming disk is never the reason
  // someone is waiting for a first frame. A sweep that fails changes nothing
  // except that the cache stays large, so it is said once and dropped.
  void sweepThumbnails().catch((err) => {
    console.error("thumbnail sweep failed", err);
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
