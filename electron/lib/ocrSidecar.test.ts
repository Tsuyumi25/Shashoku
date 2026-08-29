import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@shared/ipc/channels";

/**
 * A stand-in for `ChildProcessWithoutNullStreams` with just enough behaviour
 * to drive the handshake and request paths: real streams (so `readline` and
 * `LineSplitter` work unmodified), an `EventEmitter` for `spawn`/`error`/`exit`,
 * and a `kill` that echoes back the `exit` a real signal would eventually
 * produce, on its own macrotask, rather than synchronously — a synchronous
 * echo would hide ordering bugs the real process could actually trigger.
 */
class FakeChild extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    setTimeout(() => {
      this.exitCode = null;
      this.signalCode = typeof signal === "string" ? signal : "SIGTERM";
      this.emit("exit", null, this.signalCode);
    }, 0);
    return true;
  });

  constructor() {
    super();
    // Real `spawn` fires asynchronously; queuing this on a microtask (rather
    // than emitting it inline in the constructor) keeps that true here too,
    // so a test has to `flush()` past it like it would past the real thing.
    queueMicrotask(() => this.emit("spawn"));
  }
}

let currentChild: FakeChild | null = null;
const spawnMock = vi.fn((..._args: unknown[]) => {
  const child = new FakeChild();
  currentChild = child;
  return child;
});
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

class FakeWebContents {
  send = vi.fn();
}
class FakeWindow {
  webContents = new FakeWebContents();
  isDestroyed = () => false;
}
let fakeWindow: FakeWindow;
let logDir: string;
vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/fake/app",
    getPath: () => logDir,
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
}));

/** A handful of microtask turns — enough for any chain of `.then()`s this
 * module's promise plumbing produces (ping resolves -> `starting` resolves
 * -> the queued request's `send()` runs -> its `stdin.write` fires). */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function lastRequest(child: FakeChild): { id: number; op: string } {
  const calls = child.stdin.write.mock.calls;
  const raw = calls.at(-1)?.[0] as string;
  return JSON.parse(raw.trim());
}

function reply(child: FakeChild, id: number, result: unknown) {
  child.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
}

function replyError(child: FakeChild, id: number, error: string) {
  child.stdout.write(`${JSON.stringify({ id, ok: false, error })}\n`);
}

function progress(child: FakeChild, id: number, station: string) {
  child.stdout.write(`${JSON.stringify({ id, station, stations: [station] })}\n`);
}

function statusCalls() {
  return fakeWindow.webContents.send.mock.calls
    .filter(([channel]) => channel === CHANNELS.ocrStatus)
    .map(([, payload]) => payload);
}

/** Boots a fresh module instance with fresh mocks, and returns everything a
 * test needs to drive it. Fresh per test because `ocrSidecar()` is a
 * module-level singleton. */
async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "shashoku-sidecar-test-"));
  tempDirs.push(dir);
  logDir = dir;

  const { EngineLog } = await import("./engineLog");
  const logSpy = vi.spyOn(EngineLog.prototype, "write");

  const mod = await import("./ocrSidecar");
  return {
    engine: mod.ocrSidecar(),
    logSpy,
    HANDSHAKE_SILENCE_MS: mod.HANDSHAKE_SILENCE_MS,
    REQUEST_SILENCE_MS: mod.REQUEST_SILENCE_MS,
    SHUTDOWN_ANSWER_MS: mod.SHUTDOWN_ANSWER_MS,
    SHUTDOWN_GRACE_MS: mod.SHUTDOWN_GRACE_MS,
  };
}

/** Drives a fresh child through a successful handshake and returns it. */
async function bootReady() {
  const booted = await boot();
  const resultPromise = booted.engine.models();
  await flush();
  const child = currentChild;
  if (!child) throw new Error("test setup: spawn was not called");
  const ping = lastRequest(child);
  reply(child, ping.id, { pong: true });
  await flush();
  await resultReplyForModels(child);
  await resultPromise;
  return { ...booted, child };
}

/** `models()` is the request used to drive the handshake in most tests; this
 * answers it so the boot helper's own promise settles. */
async function resultReplyForModels(child: FakeChild) {
  const req = lastRequest(child);
  reply(child, req.id, []);
  await flush();
}

let tempDirs: string[] = [];

const originalShashokuPython = process.env.SHASHOKU_PYTHON;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  currentChild = null;
  fakeWindow = new FakeWindow();
  spawnMock.mockClear();
  delete process.env.SHASHOKU_PYTHON;
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  if (originalShashokuPython === undefined) delete process.env.SHASHOKU_PYTHON;
  else process.env.SHASHOKU_PYTHON = originalShashokuPython;
});

describe("handshake", () => {
  it("sends ping before announcing ready, and only then lets the request through", async () => {
    const { engine, logSpy } = await boot();
    const resultPromise = engine.models();
    await flush();

    const child = currentChild;
    if (!child) throw new Error("spawn was not called");
    const ping = lastRequest(child);
    expect(ping.op).toBe("ping");
    // The handshake owns the only line written so far — the real request is
    // still queued behind `starting`.
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(statusCalls()).toEqual([{ state: "starting" }]);

    reply(child, ping.id, { pong: true });
    await flush();

    expect(statusCalls()).toEqual([{ state: "starting" }, { state: "ready" }]);
    expect(child.stdin.write).toHaveBeenCalledTimes(2);
    const req = lastRequest(child);
    expect(req.op).toBe("models");

    reply(child, req.id, [{ model: "hayai", loaded: false, cached: false }]);
    await flush();
    await expect(resultPromise).resolves.toEqual([{ model: "hayai", loaded: false, cached: false }]);

    expect(logSpy.mock.calls.some(([line]) => /spawned; awaiting handshake/.test(line))).toBe(true);
    expect(logSpy.mock.calls.some(([line]) => /handshake ok; ready/.test(line))).toBe(true);
  });

  it("kills the process, reports error, and rejects startup when the ping goes unanswered", async () => {
    const { engine, logSpy, HANDSHAKE_SILENCE_MS } = await boot();
    const resultPromise = engine.models();
    await flush();
    resultPromise.catch(() => {});

    const child = currentChild;
    if (!child) throw new Error("spawn was not called");
    lastRequest(child); // the ping; deliberately never answered

    await vi.advanceTimersByTimeAsync(HANDSHAKE_SILENCE_MS);
    await flush();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(resultPromise).rejects.toThrow(/did not answer the handshake/);
    expect(statusCalls()).toEqual([
      { state: "starting" },
      { state: "error", detail: expect.stringContaining("did not answer the handshake") },
    ]);
    expect(logSpy.mock.calls.some(([line]) => /handshake failed/.test(line))).toBe(true);

    // The kill's own `exit` echoes in on its own timer — it must not flip the
    // status back to "stopped" and contradict what was just reported.
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(statusCalls()).toEqual([
      { state: "starting" },
      { state: "error", detail: expect.stringContaining("did not answer the handshake") },
    ]);
  });

  it("treats the engine dying on its own before the pong the same as a failed handshake", async () => {
    const { engine, logSpy } = await boot();
    const resultPromise = engine.models();
    await flush();
    resultPromise.catch(() => {});

    const child = currentChild;
    if (!child) throw new Error("spawn was not called");
    lastRequest(child); // the ping; never answered because the process is about to die

    child.emit("exit", 1, null);
    await flush();

    expect(child.kill).not.toHaveBeenCalled();
    await expect(resultPromise).rejects.toThrow(/before answering the handshake/);
    expect(statusCalls()).toEqual([
      { state: "starting" },
      { state: "error", detail: expect.stringContaining("before answering the handshake") },
    ]);
    expect(logSpy.mock.calls.some(([line]) => /exited: code 1/.test(line))).toBe(true);
  });

  it("uses its own 30s budget, distinct from the request budget", async () => {
    const { HANDSHAKE_SILENCE_MS, REQUEST_SILENCE_MS } = await boot();
    expect(HANDSHAKE_SILENCE_MS).toBe(30_000);
    expect(HANDSHAKE_SILENCE_MS).not.toBe(REQUEST_SILENCE_MS);
  });
});

describe("ordinary requests, after the handshake succeeds", () => {
  it("still gives up on silence, with the request's own reason", async () => {
    const { engine, child, REQUEST_SILENCE_MS } = await bootReady();
    const resultPromise = engine.readPage("/img.png", true);
    await flush();
    resultPromise.catch(() => {});
    lastRequest(child); // the readPage request itself

    await vi.advanceTimersByTimeAsync(REQUEST_SILENCE_MS);
    await flush();

    await expect(resultPromise).rejects.toThrow(/did not answer: readPage/);
  });

  it("keeps resetting the silence budget on progress, same as before the handshake existed", async () => {
    const { engine, child, REQUEST_SILENCE_MS } = await bootReady();
    const resultPromise = engine.readPage("/img.png", true);
    await flush();
    const req = lastRequest(child);

    // Two stretches that would each individually exceed the budget, each
    // interrupted by a progress word just before the deadline.
    await vi.advanceTimersByTimeAsync(REQUEST_SILENCE_MS - 1_000);
    progress(child, req.id, "detect");
    await flush();
    await vi.advanceTimersByTimeAsync(REQUEST_SILENCE_MS - 1_000);
    progress(child, req.id, "read");
    await flush();
    await vi.advanceTimersByTimeAsync(REQUEST_SILENCE_MS - 1_000);
    await flush();

    reply(child, req.id, { regions: [] });
    await flush();

    await expect(resultPromise).resolves.toEqual({ regions: [] });
  });

  it("does not let the handshake's shorter budget leak into an ordinary request", async () => {
    const { engine, child, HANDSHAKE_SILENCE_MS } = await bootReady();
    const resultPromise = engine.readPage("/img.png", true);
    await flush();
    const req = lastRequest(child);

    // Past the handshake's own timeout, nowhere near the request's.
    await vi.advanceTimersByTimeAsync(HANDSHAKE_SILENCE_MS);
    await flush();

    let settled = false;
    resultPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flush();
    expect(settled).toBe(false);

    reply(child, req.id, { regions: [] });
    await flush();
    await expect(resultPromise).resolves.toBeDefined();
  });

  it("still rejects with the engine's own error message, unaffected by the handshake refactor", async () => {
    const { engine, child } = await bootReady();
    const resultPromise = engine.readPage("/img.png", true);
    await flush();
    const req = lastRequest(child);

    replyError(child, req.id, "boom");
    await flush();

    await expect(resultPromise).rejects.toThrow("boom");
  });
});

describe("stop", () => {
  // This is the half of "no longer fire-and-forget" that lives inside the
  // engine itself: given a real exit, or none, `stop()` still has to settle
  // rather than return before either has happened. The other half — the
  // `before-quit` call site not racing ahead of this promise — is
  // `electron/ipc/ocr.test.ts`; that file is what actually regressed before
  // this fix, since this method's own wait-then-kill shape was already
  // correct and simply untested.
  it("asks first, and waits for the child to actually exit before resolving", async () => {
    const { engine, child } = await bootReady();
    const stopPromise = engine.stop();
    await flush();

    const shutdown = lastRequest(child);
    expect(shutdown.op).toBe("shutdown");

    reply(child, shutdown.id, {});
    await flush();
    expect(child.stdin.end).toHaveBeenCalled();

    let settled = false;
    stopPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    child.emit("exit", 0, null);
    await flush();

    expect(settled).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("force-kills once the grace period passes without the child exiting on its own", async () => {
    const { engine, child, SHUTDOWN_GRACE_MS } = await bootReady();
    const stopPromise = engine.stop();
    await flush();

    reply(child, lastRequest(child).id, {});
    await flush();
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await flush();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    // The kill's own exit echoes in on its own timer, same as the
    // handshake's — see the equivalent step in the handshake tests above.
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  // Both tests above answer the `shutdown`, which is the case that was never
  // in doubt. The engine only answers when it is between requests — `stop()`'s
  // own comment says as much — so the case that decides how long a quit takes
  // is the one where it is inside a native call and never answers at all.
  it("gives up on an unanswered shutdown in its own budget, not the request's", async () => {
    const { engine, child, SHUTDOWN_ANSWER_MS, SHUTDOWN_GRACE_MS } = await bootReady();
    const stopPromise = engine.stop();
    await flush();
    expect(lastRequest(child).op).toBe("shutdown");

    // Deliberately never answered, exactly as a busy engine would not answer.
    await vi.advanceTimersByTimeAsync(SHUTDOWN_ANSWER_MS);
    await flush();
    expect(child.stdin.end).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await flush();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(0);
    await flush();
    await expect(stopPromise).resolves.toBeUndefined();
  });

  it("keeps the whole shutdown far below a single request's silence budget", async () => {
    const { engine, SHUTDOWN_ANSWER_MS, SHUTDOWN_GRACE_MS, REQUEST_SILENCE_MS } =
      await bootReady();
    engine.stop();
    expect(SHUTDOWN_ANSWER_MS + SHUTDOWN_GRACE_MS).toBeLessThan(REQUEST_SILENCE_MS / 10);
  });

  it("resolves immediately, without spawning anything, when no engine has ever run", async () => {
    const { engine } = await boot();
    await expect(engine.stop()).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("launch wiring", () => {
  // These exercise the impure `launchSpec()`/`sanitizedEnv()` wrappers, not
  // the platform logic itself — that matrix lives in `enginePlatform.test.ts`
  // and `modelHome.test.ts`, tested as pure functions with the platform as a
  // parameter. This just guards that the wiring between them and `spawn()`
  // passes the right arguments in the right order.
  it("spawns the dev venv interpreter under the app path when nothing is supplied", async () => {
    const { engine } = await boot();
    void engine.models();
    await flush();

    const [interpreter, , options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd?: string; env: NodeJS.ProcessEnv },
    ];
    expect(interpreter).toBe("/fake/app/python/.venv/bin/python");
    expect(options.cwd).toBe("/fake/app/python");
    expect(options.env.PYTHONUTF8).toBe("1");
  });

  it("lets SHASHOKU_PYTHON override the interpreter, with no cwd of its own", async () => {
    process.env.SHASHOKU_PYTHON = "/opt/custom/python";
    const { engine } = await boot();
    void engine.models();
    await flush();

    const [interpreter, , options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd?: string },
    ];
    expect(interpreter).toBe("/opt/custom/python");
    expect(options.cwd).toBeUndefined();
  });
});
