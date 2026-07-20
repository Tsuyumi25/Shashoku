import { BrowserWindow } from "electron";
import { join } from "node:path";
import { interceptClose } from "./ipc/windowControls";
import type { WindowRole } from "@shared/ipc/channels";

export function createWindow(role: WindowRole): BrowserWindow {
  const win = new BrowserWindow({
    width: role === "text-board" ? 720 : 1400,
    height: role === "text-board" ? 640 : 900,
    frame: role === "text-board", // 文字畫布只用原生標題列；主視窗維持自畫殼
    title: role === "text-board" ? "草稿紙" : "Shashoku 写植",
    backgroundColor: "#262624",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false,
    },
  });

  if (role === "main") {
    interceptClose(win); // 主視窗關閉交給 renderer 跑翻譯 dirty 確認流程
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("windowRole", role);
    win.loadURL(url.toString());
    if (role === "main") win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { windowRole: role },
    });
  }

  // 畫布有自己的 zoom，攔掉 Chromium 的頁面縮放快捷鍵，避免整頁被縮放。
  win.webContents.setZoomFactor(1);
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  win.webContents.on("before-input-event", (e, input) => {
    if (input.control && (input.key === "=" || input.key === "-" || input.key === "0")) {
      e.preventDefault();
    }
    // 應用選單已移除（解放 Alt），dev 模式手動補 DevTools/Reload
    if (isDev && input.type === "keyDown") {
      if (input.key === "F12") {
        win.webContents.toggleDevTools();
        e.preventDefault();
      } else if (input.control && !input.shift && input.key.toLowerCase() === "r") {
        win.webContents.reload();
        e.preventDefault();
      }
    }
  });

  return win;
}
