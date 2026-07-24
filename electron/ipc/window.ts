import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS } from "@shared/ipc/channels";

export function registerWindowHandlers(): void {
  ipcMain.on(CHANNELS.windowMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on(CHANNELS.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(CHANNELS.windowClose, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
}
