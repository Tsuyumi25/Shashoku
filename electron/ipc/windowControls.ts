import { BrowserWindow, ipcMain, shell } from "electron";
import { CHANNELS } from "@shared/ipc/channels";

// 原版 Help > View Help 開啟的官網
const HELP_URL = "http://noodlefighter.com/label_plus";

const forceClosable = new WeakSet<BrowserWindow>();

/** 攔下所有關窗路徑（X、Alt+F4、選單結束），交給 renderer 跑 dirty 確認流程 */
export function interceptClose(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (forceClosable.has(win) || win.webContents.isDestroyed()) return;
    e.preventDefault();
    win.webContents.send(CHANNELS.closeRequested);
  });
}

export function registerWindowControlHandlers(): void {
  ipcMain.on(CHANNELS.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on(CHANNELS.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on(CHANNELS.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on(CHANNELS.windowForceClose, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    forceClosable.add(win);
    win.close();
  });
  ipcMain.on(CHANNELS.openHelp, () => {
    void shell.openExternal(HELP_URL);
  });
}
