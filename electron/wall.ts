import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { CHANNELS } from "@shared/ipc/channels";
import type { WallScene } from "@shared/wall/scene";

/**
 * The wall in a window of its own, for a second screen.
 *
 * It holds no project: the editor window is where the chapter lives, and it
 * hands the wall what to draw. Messages between the two pass through here,
 * since a renderer can only speak to the process that made it.
 */
let wallWindow: BrowserWindow | null = null;

function openWall(): void {
  if (wallWindow && !wallWindow.isDestroyed()) {
    if (wallWindow.isMinimized()) wallWindow.restore();
    wallWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 900,
    height: 1100,
    title: "Shashoku 全覽",
    backgroundColor: "#262624",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The same reason the editor's window gives: preload loads the engine.
      sandbox: false,
    },
  });
  wallWindow = win;
  win.once("closed", () => {
    if (wallWindow === win) wallWindow = null;
    for (const other of BrowserWindow.getAllWindows()) other.webContents.send(CHANNELS.wallState, false);
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#wall`);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash: "wall" });
}

/** The editor window, which is every window that is not the wall. */
function editors(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => w !== wallWindow && !w.isDestroyed());
}

export function closeWall(): void {
  if (wallWindow && !wallWindow.isDestroyed()) wallWindow.close();
}

/**
 * Both windows load the same preload, so either could send any channel. Each
 * message is taken only from the side that is meant to speak it.
 */
function fromWall(e: IpcMainEvent): boolean {
  return wallWindow !== null && !wallWindow.isDestroyed() && e.sender === wallWindow.webContents;
}

export function registerWallHandlers(): void {
  ipcMain.on(CHANNELS.wallOpen, (e) => {
    if (!fromWall(e)) openWall();
  });

  // The wall asks once it can listen; the editor is told the wall is there and
  // publishes from then on.
  ipcMain.on(CHANNELS.wallSceneWanted, (e) => {
    if (!fromWall(e)) return;
    for (const w of editors()) {
      w.webContents.send(CHANNELS.wallState, true);
      w.webContents.send(CHANNELS.wallSceneWanted);
    }
  });

  ipcMain.on(CHANNELS.wallScene, (e, scene: WallScene) => {
    if (fromWall(e) || !wallWindow || wallWindow.isDestroyed()) return;
    wallWindow.webContents.send(CHANNELS.wallScene, scene);
  });

  ipcMain.on(CHANNELS.wallSelection, (e, ids: string[]) => {
    if (fromWall(e) || !wallWindow || wallWindow.isDestroyed()) return;
    wallWindow.webContents.send(CHANNELS.wallSelection, ids);
  });

  for (const channel of [CHANNELS.wallSelect, CHANNELS.wallBrush]) {
    ipcMain.on(channel, (e, payload: string[]) => {
      if (!fromWall(e)) return;
      for (const w of editors()) {
        w.webContents.send(channel, payload);
        w.focus();
      }
    });
  }

  ipcMain.on(CHANNELS.wallReveal, (e, pageId: string, id: string) => {
    if (!fromWall(e)) return;
    for (const w of editors()) {
      w.webContents.send(CHANNELS.wallReveal, pageId, id);
      w.focus();
    }
  });
}
