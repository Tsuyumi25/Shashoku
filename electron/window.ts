import { BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { CHANNELS } from "@shared/ipc/channels";
import { forgetReady } from "./mcp/bridge";

/**
 * How long the window waits to hear anything at all from the renderer while
 * it settles its last writes. Restarted by every `windowCloseBusy`, so this is
 * how long silence is tolerated rather than how long the work may take: a
 * renderer that is wedged or gone must not hold a window open, and one four
 * seconds into a write on a slow disk is neither of those.
 */
const CLOSE_SILENCE_MS = 3000;

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
      // Not `__dirname`: electron-vite defines it by appending a shim after
      // the bundle's last import statement, and a bundled dependency's doc
      // comment can move that point past this line.
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The default sandbox restricts preload's require() to a whitelist
      // (electron/events/timers/url), which cannot reach the engine addon.
      // contextIsolation stays on, so the renderer still has no Node access —
      // this only gives preload back a full require() to load the .node.
      sandbox: false,
    },
  });

  // Every document this window loads, the first included: what answers MCP is
  // whatever has mounted, and a load beginning is that becoming untrue again.
  win.webContents.on("did-start-loading", forgetReady);

  // Menu.setApplicationMenu(null) in index.ts strips the app menu, and with it
  // every accelerator Electron would otherwise wire up for free — F12 among
  // them. A packaged build has no menu and no terminal, so without this the
  // only way to see what a sidecar wrote to stderr would be to reproduce the
  // failure on a machine running a dev build instead. Ctrl+Shift+I is not the
  // substitute: this app already binds it to inverting the mask selection.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F12" || input.isAutoRepeat) return;
    event.preventDefault();
    win.webContents.toggleDevTools();
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
    let giveUp = setTimeout(closeForReal, CLOSE_SILENCE_MS);
    const heard = () => {
      clearTimeout(giveUp);
      giveUp = setTimeout(closeForReal, CLOSE_SILENCE_MS);
    };
    ipcMain.on(CHANNELS.windowCloseBusy, heard);
    // Asking the user is the one wait with no end: the window stays until they
    // answer, however long that is.
    ipcMain.handle(CHANNELS.windowCloseFailed, async () => {
      clearTimeout(giveUp);
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["再試一次", "不儲存就離開"],
        defaultId: 0,
        cancelId: 0,
        message: "有變更沒有存進磁碟",
        detail: "離開的話那些變更就沒了。",
      });
      heard();
      return response === 1 ? "discard" : "retry";
    });
    ipcMain.once(CHANNELS.windowCloseReady, () => {
      clearTimeout(giveUp);
      ipcMain.off(CHANNELS.windowCloseBusy, heard);
      ipcMain.removeHandler(CHANNELS.windowCloseFailed);
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
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
}
