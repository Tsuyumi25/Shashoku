import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import { OVERLAY_HEIGHT } from "../window";

export function registerWindowHandlers(): void {
  ipcMain.on(CHANNELS.windowSetOverlay, (e, color: string, symbolColor: string) => {
    // macOS has traffic lights instead of an overlay, and the call throws there.
    if (process.platform === "darwin") return;
    BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({
      color,
      symbolColor,
      height: OVERLAY_HEIGHT,
    });
  });
}
