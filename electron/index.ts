import { app, BrowserWindow, Menu } from "electron";
import { createWindow } from "./window";

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
  mainWindow = createWindow();
  mainWindow.once("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
