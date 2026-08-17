import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { CHANNELS } from "@shared/ipc/channels";
import type { McpQueryMethod, McpReply } from "@shared/mcp/types";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

let getWindow: () => BrowserWindow | null = () => null;

// A renderer that never answers must not hold a tool call open for ever: the
// agent on the other end learns more from a prompt failure than from silence.
const ANSWER_TIMEOUT_MS = 10_000;

export function registerMcpBridge(windowGetter: () => BrowserWindow | null) {
  getWindow = windowGetter;
  ipcMain.on(CHANNELS.mcpReply, (_e, reply: McpReply) => {
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new Error(reply.error ?? "renderer refused"));
  });
}

export function askRenderer<T>(method: McpQueryMethod, params?: unknown): Promise<T> {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    return Promise.reject(new Error("Shashoku window is not open"));
  }
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("renderer did not answer in time"));
    }, ANSWER_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
    win.webContents.send(CHANNELS.mcpQuery, { id, method, params });
  });
}
