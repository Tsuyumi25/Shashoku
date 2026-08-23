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

/**
 * Longer than the answer timeout because it covers a different thing: not a
 * renderer refusing to reply but an application still starting. A cold launch
 * has to load a bundle and mount an interface, and an agent that connected
 * while that happened should wait rather than be told the window is broken.
 */
const READY_TIMEOUT_MS = 60_000;

/**
 * Whether the window can be spoken to yet.
 *
 * The endpoint begins listening before the window is built, so an early tool
 * call reaches a window whose handler is not attached — and `send` delivers
 * rather than queues, so that call is not slow, it is lost. Holding it here
 * until the renderer says it has mounted is the difference between a race the
 * fast machine wins and a wait.
 */
let answering = false;
let waiting: (() => void)[] = [];

function announceReady() {
  answering = true;
  const held = waiting;
  waiting = [];
  for (const resume of held) resume();
}

/**
 * A document is loading, so whatever had mounted is on its way out. Held calls
 * stay held and are released by the next mount rather than by this one, which
 * is what makes a reload a pause instead of a window with no handler being
 * spoken to.
 */
export function forgetReady() {
  answering = false;
}

/** Bounded, so an interface that never mounts is a failure and not a hang. */
function waitUntilReady(): Promise<void> {
  if (answering) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Shashoku is still starting up")),
      READY_TIMEOUT_MS,
    );
    waiting.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function registerMcpBridge(windowGetter: () => BrowserWindow | null) {
  getWindow = windowGetter;
  // Not `once`: a reload mounts again and says so again, and the gate has been
  // shut behind it in the meantime.
  ipcMain.on(CHANNELS.mcpReady, announceReady);
  ipcMain.on(CHANNELS.mcpReply, (_e, reply: McpReply) => {
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new Error(reply.error ?? "renderer refused"));
  });
}

export async function askRenderer<T>(method: McpQueryMethod, params?: unknown): Promise<T> {
  await waitUntilReady();
  // Read after the wait, not before: what was open when an agent connected
  // says nothing about what is open now.
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    throw new Error("Shashoku window is not open");
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
