import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@shared/ipc/channels";

/**
 * `registerOcrHandlers()` used to end the app on `before-quit` without
 * waiting for the engine: `void engine.stop().catch(() => {})`. On Windows
 * that races Electron's own process exit against a *separate* process (the
 * Python sidecar has no job-object tie to this one) — the window can close
 * before the sidecar has let go of the files an update is about to overwrite.
 * These tests pin the fix: quit is held up until `stop()` settles, and only
 * that.
 */

type QuitHandler = (event: { preventDefault: () => void }) => void;

let quitHandlers: QuitHandler[];
let appQuit: ReturnType<typeof vi.fn<() => void>>;
let appOn: ReturnType<typeof vi.fn<(event: string, handler: QuitHandler) => void>>;
let ipcHandle: ReturnType<typeof vi.fn<(channel: string, fn: (...args: unknown[]) => unknown) => void>>;

vi.mock("electron", () => ({
  app: {
    on: (event: string, handler: QuitHandler) => appOn(event, handler),
    quit: () => appQuit(),
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipcHandle(channel, fn),
  },
}));

let stopResolvers: Array<() => void>;
let fakeEngine: {
  models: ReturnType<typeof vi.fn>;
  readPage: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

vi.mock("../lib/ocrSidecar", () => ({
  ocrSidecar: () => fakeEngine,
}));

/** A handful of microtask turns — enough for the `.catch().then()` chain in
 * the `before-quit` handler to run to its next await point. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  quitHandlers = [];
  appQuit = vi.fn();
  appOn = vi.fn((event: string, handler: QuitHandler) => {
    if (event === "before-quit") quitHandlers.push(handler);
  });
  ipcHandle = vi.fn();
  stopResolvers = [];
  fakeEngine = {
    models: vi.fn(),
    readPage: vi.fn(),
    unload: vi.fn(),
    stop: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stopResolvers.push(resolve);
        }),
    ),
  };

  const { registerOcrHandlers } = await import("./ocr");
  registerOcrHandlers();
});

it("registers a handler for every ocr channel", () => {
  const registered = ipcHandle.mock.calls.map(([channel]) => channel);
  expect(registered).toEqual(
    expect.arrayContaining([CHANNELS.ocrModels, CHANNELS.ocrReadPage, CHANNELS.ocrUnload, CHANNELS.ocrStop]),
  );
});

describe("before-quit", () => {
  it("holds the quit up until the engine actually stops, rather than racing ahead of it", async () => {
    expect(quitHandlers).toHaveLength(1);
    const preventDefault = vi.fn();
    quitHandlers[0]({ preventDefault });
    await flush();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fakeEngine.stop).toHaveBeenCalledTimes(1);
    // Still blocked: nothing has re-quit while stop() is pending.
    expect(appQuit).not.toHaveBeenCalled();

    stopResolvers[0]();
    await flush();

    expect(appQuit).toHaveBeenCalledTimes(1);
  });

  it("does not re-stop or re-block on the before-quit its own re-quit raises", async () => {
    const preventDefault = vi.fn();
    quitHandlers[0]({ preventDefault });
    await flush();
    stopResolvers[0]();
    await flush();
    expect(appQuit).toHaveBeenCalledTimes(1);

    // Real Electron fires `before-quit` again for the `app.quit()` this
    // handler itself calls. A handler that forgot it already stopped the
    // engine would call `stop()` a second time and block forever.
    quitHandlers[0]({ preventDefault });
    await flush();

    expect(fakeEngine.stop).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("still quits even when the engine's own stop() rejects", async () => {
    fakeEngine.stop.mockReturnValueOnce(Promise.reject(new Error("boom")));
    const preventDefault = vi.fn();
    quitHandlers[0]({ preventDefault });
    await flush();

    expect(appQuit).toHaveBeenCalledTimes(1);
  });
});
