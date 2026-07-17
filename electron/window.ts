import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1c1c1a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
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
}
