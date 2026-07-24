import { app, BrowserWindow, Menu } from "electron";
import { createWindow } from "./window";
import { registerProjectHandlers } from "./ipc/project";
import { registerShashokuProjectHandlers } from "./ipc/shashokuProject";
import { registerWindowHandlers } from "./ipc/window";

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
  registerProjectHandlers();
  registerShashokuProjectHandlers();
  registerWindowHandlers();
  mainWindow = createWindow();
  mainWindow.once("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
