import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { app, BrowserWindow } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import type { OcrModel, OcrPageResult, OcrProgress, OcrStatus } from "@shared/ocr/types";
import { type EngineLaunchSpec, resolveLaunchSpec, resolveSidecarEnv } from "./enginePlatform";
import { EngineLog } from "./engineLog";
import { LineSplitter } from "./lineSplitter";
import { modelHome } from "./modelHome";

/**
 * The Python models, as a process the main process owns.
 *
 * Named for OCR because that is what it was built for and what most of it still
 * is, but the retoucher lives here too: the models share an interpreter and a
 * set of torch imports, and a second process would pay for both again to run
 * one more network.
 *
 * A child rather than a `utilityProcess`, because that one forks a Node script
 * and this is a Python interpreter. One line of JSON per request on its stdin,
 * one per reply on its stdout, everything else on its stderr — the protocol has
 * to have a channel of its own, since torch and its dependencies print banners
 * to stdout without being asked and one of them would make the stream
 * unreadable.
 *
 * Started on first use and not before. Loading a model is seconds and hundreds
 * of megabytes for a feature a given session may never reach for; starting the
 * process itself is tens of milliseconds, because nothing heavy is imported
 * until a model is asked for.
 */

/** The retoucher, which is not one of the OCR models and is not chosen between. */
const INPAINT_MODEL = "anime-lama";

/**
 * How long a request may go without a word before it is treated as hung.
 *
 * ⚠️ Silence rather than elapsed time, which is what makes it survive a whole
 * page's trip: that is four readers over a page of regions and can run past any
 * honest total, but it never goes this long without reaching a station.
 */
export const REQUEST_SILENCE_MS = 180_000;

/**
 * How long the handshake `ping` may go unanswered before the engine is
 * declared dead on arrival.
 *
 * Deliberately its own number, not `REQUEST_SILENCE_MS`: the handshake has
 * nothing heavy to import yet, so a cold interpreter answering one line of
 * JSON should be near-instant — but the very first launch may be reading that
 * interpreter off a cold Windows disk, so it cannot be cut too fine either.
 * 30s is generous for that worst case while still being six times short of
 * the request budget, so a hung engine is caught long before a caller would
 * otherwise blame "no one answered that request".
 */
export const HANDSHAKE_SILENCE_MS = 30_000;

/**
 * How long the `shutdown` request itself may go unanswered.
 *
 * Its own number, and emphatically not `REQUEST_SILENCE_MS`: that budget is
 * sized for a page of OCR, while the engine that cannot answer this is
 * precisely the engine that is mid-request — see `stop()` below. Spending the
 * request budget here would mean waiting three minutes for a reply only an
 * *idle* engine was ever going to send, and `before-quit` awaits this, so
 * those three minutes are a window the app refuses to close in.
 *
 * An idle engine answers in the time it takes to write one line of JSON, so
 * this only has to cover one that has just finished work and not yet come
 * back round to its read.
 */
export const SHUTDOWN_ANSWER_MS = 2_000;

/**
 * How long a well-mannered goodbye is given before the signal.
 *
 * Exported for the same reason as the two silence budgets above: a test
 * driving fake timers needs the real number, not a copy that could drift
 * from it.
 */
export const SHUTDOWN_GRACE_MS = 2_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  /** Restarts the silence timer. Called every time the request says anything. */
  heard: () => void;
}

function launchSpec(): EngineLaunchSpec {
  // Packaged: the payload sits beside `resources/`, not inside `app.asar`.
  // Dev: `getAppPath()` is this repo's root.
  const root = app.isPackaged ? dirname(process.resourcesPath) : app.getAppPath();
  return resolveLaunchSpec(process.platform, app.isPackaged, root, process.env.SHASHOKU_PYTHON);
}

function sanitizedEnv(pythonPath: string[] | undefined): NodeJS.ProcessEnv {
  return resolveSidecarEnv(process.platform, process.env, modelHome(), pythonPath);
}

class OcrSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private starting: Promise<void> | null = null;
  // Keyed by the registry's own names rather than by `OcrModel`, because not
  // everything the sidecar holds is one.
  private loading = new Map<string, Promise<void>>();
  // One log across every restart, not one per attempt — a crash loop should
  // read as a crash loop in the file, not as a series of empty ones.
  private readonly log = new EngineLog();

  private announce(status: OcrStatus) {
    this.broadcast(CHANNELS.ocrStatus, status);
  }

  private broadcast(channel: string, payload: unknown) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  }

  /**
   * Everything waiting is told, and the handle is dropped so the next request
   * builds a fresh one.
   *
   * Called from both `error` and `exit`, because they are not the same event
   * and neither implies the other: a spawn that fails because the interpreter
   * is not there emits only `error`, and forgetting to reset here would cache
   * that failure until the app restarts — fixing the path would change nothing.
   */
  private collapse(reason: string) {
    const error = new Error(reason);
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.loading.clear();
    this.child = null;
    this.starting = null;
  }

  private start(): Promise<void> {
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((ready, failed) => {
      this.announce({ state: "starting" });
      const { interpreter, cwd, pythonPath } = launchSpec();
      const env = sanitizedEnv(pythonPath);
      // Only the values this function itself decided, never the whole
      // environment — the rest is the user's machine, and may hold tokens.
      this.log.write(
        `starting: interpreter=${interpreter} cwd=${cwd ?? "(app default)"} ` +
          `LD_LIBRARY_PATH=${env.LD_LIBRARY_PATH || "(unset)"} HF_HOME=${env.HF_HOME || "(unset)"}`,
      );
      const child = spawn(interpreter, ["-m", "shashoku_ocr"], {
        cwd,
        env,
      });
      this.child = child;

      createInterface({ input: child.stdout }).on("line", (line) => {
        let message: {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: string;
          station?: string;
          stations?: string[];
        };
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.id === undefined) return;
        const waiter = this.pending.get(message.id);
        if (!waiter) return;

        // An interim word carries a station and no verdict. It is what the
        // request is still alive, so it buys the request more time and is
        // passed on rather than settling anything.
        if (message.station !== undefined) {
          waiter.heard();
          this.broadcast(CHANNELS.ocrProgress, {
            station: message.station,
            stations: message.stations ?? [],
          } satisfies OcrProgress);
          return;
        }

        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.ok) waiter.resolve(message.result);
        else waiter.reject(new Error(message.error ?? "the OCR engine gave no reason"));
      });

      // Not `readline`: stderr carries a `\r`-redrawn progress bar, and
      // `readline` only breaks lines on `\n` — it would hold the whole
      // download as one line until the bar finally closes.
      const splitter = new LineSplitter();
      const record = (line: string) => {
        console.log("[ocr]", line);
        this.log.write(line);
      };
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        for (const line of splitter.push(chunk)) record(line);
      });
      child.stderr.on("end", () => {
        for (const line of splitter.flush()) record(line);
      });

      // `spawn` only proves the OS created a process; it says nothing about
      // whether the interpreter inside it is any good. A missing package, an
      // unloadable native library, a syntax error — every one of those spawns
      // cleanly and then stays silent, which is exactly the shape of failure
      // this handshake exists to catch before it is mistaken for a hung
      // request three minutes later.
      //
      // Two flags, not one, because the two things that can go wrong here are
      // independent: `startupSettled` says whether a verdict on the handshake
      // has already been delivered, and `expectingExit` says whether an exit
      // about to arrive is one this code just caused itself (by killing the
      // child after a failed handshake) rather than new information.
      let startupSettled = false;
      let expectingExit = false;

      child.once("spawn", () => {
        this.log.write("spawned; awaiting handshake");
        this.send<{ pong: boolean }>(child, "ping", {}, HANDSHAKE_SILENCE_MS).then(
          () => {
            if (startupSettled) return;
            startupSettled = true;
            this.log.write("handshake ok; ready");
            this.announce({ state: "ready" });
            ready();
          },
          (problem: Error) => {
            // The child may already have reported its own death below — that
            // path settles the same promise, so there is nothing left to add.
            if (startupSettled) return;
            startupSettled = true;
            const reason = `the OCR engine did not answer the handshake: ${problem.message}`;
            this.log.write(`handshake failed: ${reason}`);
            this.announce({ state: "error", detail: reason });
            this.collapse(reason);
            expectingExit = true;
            child.kill("SIGKILL");
            failed(new Error(reason));
          },
        );
      });
      child.on("error", (problem) => {
        this.log.write(`start failed: ${problem}`);
        this.announce({ state: "error", detail: String(problem) });
        this.collapse(`the OCR engine could not start: ${problem}`);
        startupSettled = true;
        failed(problem);
      });
      child.on("exit", (code, signal) => {
        const how = signal ? `signal ${signal}` : `code ${code}`;
        this.log.write(`exited: ${how}`);
        // Expected: this is the handshake's own kill playing out, already
        // reported as an error a moment ago. A second, contradictory
        // "stopped" broadcast here would just make the status flicker.
        if (expectingExit) return;
        if (!startupSettled) {
          // Died on its own before ever answering the ping — still a
          // handshake failure, just one the engine announced by leaving
          // rather than by staying silent.
          startupSettled = true;
          const reason = `the OCR engine stopped (${how}) before answering the handshake`;
          this.announce({ state: "error", detail: reason });
          this.collapse(reason);
          failed(new Error(reason));
          return;
        }
        this.announce({ state: "stopped", detail: how });
        // The wording matters more than it looks: an engine that died takes
        // the request with it but not the next one, and saying so is what
        // turns a dead end into "try that again".
        this.collapse(`the OCR engine stopped (${how}); it will be restarted on the next request`);
      });
    });
    return this.starting;
  }

  /**
   * Sends one line of JSON to a given child and settles once its paired reply
   * arrives, or after `silenceMs` of nothing.
   *
   * Takes the child as a parameter rather than reading `this.child`: the
   * handshake has to speak to a process before that process is the ready one
   * on file, and `request()` below is just the case where the two happen to
   * be the same.
   */
  private send<T>(
    child: ChildProcessWithoutNullStreams,
    op: string,
    body: Record<string, unknown>,
    silenceMs: number,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const giveUp = () => {
        if (this.pending.delete(id)) reject(new Error(`the OCR engine did not answer: ${op}`));
      };
      const waiter: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: setTimeout(giveUp, silenceMs),
        heard: () => {
          clearTimeout(waiter.timer);
          waiter.timer = setTimeout(giveUp, silenceMs);
        },
      };
      this.pending.set(id, waiter);
      child.stdin.write(`${JSON.stringify({ id, op, ...body })}\n`);
    });
  }

  private async request<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("the OCR engine is not running");
    return this.send<T>(child, op, body, REQUEST_SILENCE_MS);
  }

  /**
   * The load itself, once per model however many callers ask at once.
   *
   * Only the retoucher comes through here now. The readers and detectors are
   * loaded by the trip on the far side, which is the only thing that knows what
   * comes next and so the only thing that can hold one set of weights at a time.
   */
  private loadOnce(model: string): Promise<void> {
    const already = this.loading.get(model);
    if (already) return already;

    const attempt = (async () => {
      try {
        await this.request<{ elapsedMs: number }>("load", { model });
      } catch (problem) {
        // Dropped so the next attempt really tries again rather than replaying
        // a stored failure.
        this.loading.delete(model);
        throw problem;
      }
    })();
    this.loading.set(model, attempt);
    return attempt;
  }

  async models() {
    return this.request<
      { model: OcrModel; loaded: boolean; cached: boolean }[]
    >("models");
  }

  /** One page, read by everything, in one trip. */
  async readPage(imagePath: string, onomatopoeia: boolean) {
    return this.request<OcrPageResult>("readPage", { image: imagePath, onomatopoeia });
  }

  /**
   * One region redrawn wherever its mask covers, all three of them as files.
   *
   * Files rather than bytes over the pipe: the protocol is one line of JSON and
   * a page-sized picture in base64 would be megabytes of it. Who owns those
   * files and when they go is the caller's, not this one's.
   */
  async inpaint(imagePath: string, maskPath: string, outPath: string) {
    await this.loadOnce(INPAINT_MODEL);
    return this.request<{ out: string; width: number; height: number }>("inpaint", {
      model: INPAINT_MODEL,
      image: imagePath,
      mask: maskPath,
      out: outPath,
    });
  }

  async unload(model: OcrModel) {
    if (!this.child) return false;
    this.loading.delete(model);
    const { unloaded } = await this.request<{ unloaded: boolean }>("unload", { model });
    return unloaded;
  }

  /**
   * Ends the process, asking first.
   *
   * Two stages because they fail differently: the engine can put its own
   * affairs in order when it is between requests, and cannot hear anything at
   * all when it is inside a native call — which is most of the time it is
   * doing work. So it is asked, and then, if it is still there, told.
   *
   * Both stages are bounded, and by their own budgets rather than the
   * request path's: the whole of this is what `before-quit` waits on, so any
   * budget spent here is a window in which the app will not close.
   *
   * `send` directly rather than `request`, which would `start()` first — a
   * stop has no business bringing an engine up to say goodbye to.
   */
  async stop() {
    const child = this.child;
    if (!child) return;

    try {
      await this.send(child, "shutdown", {}, SHUTDOWN_ANSWER_MS);
    } catch {
      // Never answered, already leaving, or already gone — all three end the
      // same way, one step down.
    }
    // Closing stdin is the same signal the engine watches for when this
    // process dies without warning, so it is also the ordinary way to end it.
    child.stdin.end();

    await new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      const impatient = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, SHUTDOWN_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(impatient);
        done();
      });
    });
  }
}

let sidecar: OcrSidecar | null = null;

export function ocrSidecar(): OcrSidecar {
  sidecar ??= new OcrSidecar();
  return sidecar;
}
