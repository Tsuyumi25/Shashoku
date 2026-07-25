import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Shashoku",
    backgroundColor: "#262624",
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The default sandbox restricts preload's require() to a whitelist
      // (electron/events/timers/url), which cannot reach the engine addon.
      // contextIsolation stays on, so the renderer still has no Node access —
      // this only gives preload back a full require() to load the .node.
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}
