import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { CHANNELS } from "@shared/ipc/channels";

/**
 * How long the window waits for the renderer to say its last writes have
 * landed. A renderer that is wedged or gone must not be able to keep a window
 * on screen that the user has asked to close, so the wait has an end.
 */
const CLOSE_GRACE_MS = 3000;

/** Must match the title bar's rendered height, or the buttons sit off-row. */
export const OVERLAY_HEIGHT = 36;

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // The size the window restores to; it starts maximized regardless.
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    title: "Shashoku",
    backgroundColor: "#262624",
    // System-drawn window buttons over our own bar: a DOM-drawn maximize
    // button is invisible to the OS, so Windows 11 would never offer Snap
    // Layouts on it. The colors are stand-ins until the renderer reports the
    // real theme through windowSetOverlay.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#2c2c2b", symbolColor: "#b7b5a9", height: OVERLAY_HEIGHT },
    show: false,
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

  // Built hidden and revealed only once maximized, so the first frame on screen
  // is already full size. maximize() reveals a hidden window by itself but
  // leaves it unfocused, hence the show() after it.
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // Autosave writes are asynchronous, and beforeunload cannot wait for one —
  // it is the close itself that has to. Every route out goes through this
  // event, the title bar's own button included, so one hook covers them all.
  let closing = false;
  let releasedForClose = false;

  function closeForReal() {
    releasedForClose = true;
    if (!win.isDestroyed()) win.close();
  }

  win.on("close", (e) => {
    if (releasedForClose) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    const giveUp = setTimeout(closeForReal, CLOSE_GRACE_MS);
    ipcMain.once(CHANNELS.windowCloseReady, () => {
      clearTimeout(giveUp);
      closeForReal();
    });
    win.webContents.send(CHANNELS.windowWillClose);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    // Undocked: docked-right devtools and the window controls overlay fight
    // over the same corner (the trade VS Code accepted for WCO too).
    win.webContents.openDevTools({ mode: "undocked" });
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}
