import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app, BrowserWindow } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import type { OcrModel, OcrStatus } from "@shared/ocr/types";

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

/** Long enough for a page of crops, short enough that a hung engine is not forever. */
const REQUEST_TIMEOUT_MS = 180_000;

/** How long a well-mannered goodbye is given before the signal. */
const SHUTDOWN_GRACE_MS = 2_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function launchSpec(): { interpreter: string; cwd?: string } {
  const supplied = process.env.SHASHOKU_PYTHON;
  if (supplied) return { interpreter: supplied };

  const root = app.getAppPath();
  return {
    interpreter: join(root, "python", ".venv", "bin", "python"),
    cwd: join(root, "python"),
  };
}

/**
 * The environment the engine gets, rather than the one this process has.
 *
 * Electron exports variables that mean something to Electron and something
 * else to anything that reads them by accident, and a Python process inheriting
 * the lot has been a source of confusing failures elsewhere. Only what the
 * engine needs is passed on.
 *
 * `LD_LIBRARY_PATH` is the interesting one: the wheels are manylinux builds
 * that expect a distribution's shared libraries, which on NixOS live wherever
 * nix-ld was told to put them.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const { PATH, HOME, USER, LANG, TMPDIR, HF_HOME, NIX_LD_LIBRARY_PATH, LD_LIBRARY_PATH } =
    process.env;
  return {
    PATH,
    HOME,
    USER,
    LANG,
    TMPDIR,
    HF_HOME,
    PYTHONUNBUFFERED: "1",
    // Progress bars are drawn on stdout, which the protocol owns.
    HF_HUB_DISABLE_PROGRESS_BARS: "1",
    LD_LIBRARY_PATH: NIX_LD_LIBRARY_PATH ?? LD_LIBRARY_PATH ?? "",
  };
}

class OcrSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private starting: Promise<void> | null = null;
  // Keyed by the registry's own names rather than by `OcrModel`, because not
  // everything the sidecar holds is one.
  private loading = new Map<string, Promise<void>>();

  private announce(status: OcrStatus) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.ocrStatus, status);
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
      const { interpreter, cwd } = launchSpec();
      const child = spawn(interpreter, ["-m", "shashoku_ocr"], {
        cwd,
        env: sanitizedEnv(),
      });
      this.child = child;

      createInterface({ input: child.stdout }).on("line", (line) => {
        let message: { id?: number; ok?: boolean; result?: unknown; error?: string };
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.id === undefined) return;
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.ok) waiter.resolve(message.result);
        else waiter.reject(new Error(message.error ?? "the OCR engine gave no reason"));
      });

      createInterface({ input: child.stderr }).on("line", (line) => {
        console.log("[ocr]", line);
      });

      child.once("spawn", () => {
        this.announce({ state: "ready" });
        ready();
      });
      child.on("error", (problem) => {
        this.announce({ state: "error", detail: String(problem) });
        this.collapse(`the OCR engine could not start: ${problem}`);
        failed(problem);
      });
      child.on("exit", (code, signal) => {
        const how = signal ? `signal ${signal}` : `code ${code}`;
        this.announce({ state: "stopped", detail: how });
        // The wording matters more than it looks: an engine that died takes
        // the request with it but not the next one, and saying so is what
        // turns a dead end into "try that again".
        this.collapse(`the OCR engine stopped (${how}); it will be restarted on the next request`);
      });
    });
    return this.starting;
  }

  private async request<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("the OCR engine is not running");

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`the OCR engine did not answer: ${op}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, op, ...body })}\n`);
    });
  }

  /**
   * Makes sure a model's weights are in memory, once.
   *
   * Reaching for a page is the decision to pay for the model that reads it, so
   * this happens on first use rather than at startup — but only on use, and
   * never as a guess about what might be wanted next.
   */
  private ensureLoaded(model: OcrModel): Promise<void> {
    return this.loadOnce(model, {
      began: () => this.announce({ state: "loading", model }),
      done: () => this.announce({ state: "ready", model }),
      failed: (problem) => this.announce({ state: "error", model, detail: String(problem) }),
    });
  }

  /**
   * The load itself, once per model however many callers ask at once.
   *
   * Separate from the announcements because those speak `OcrStatus`, which the
   * retoucher is not: it has no place in a list of readers and detectors, and
   * saying so would put it there.
   */
  private loadOnce(
    model: string,
    say: { began(): void; done(): void; failed(problem: unknown): void } = {
      began: () => {},
      done: () => {},
      failed: () => {},
    },
  ): Promise<void> {
    const already = this.loading.get(model);
    if (already) return already;

    const attempt = (async () => {
      say.began();
      try {
        await this.request<{ elapsedMs: number }>("load", { model });
        say.done();
      } catch (problem) {
        // Dropped so the next attempt really tries again rather than replaying
        // a stored failure.
        this.loading.delete(model);
        say.failed(problem);
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

  async detect(model: OcrModel, imagePath: string, minScore?: number) {
    await this.ensureLoaded(model);
    const { boxes } = await this.request<{ boxes: unknown[] }>("detect", {
      model,
      image: imagePath,
      minScore,
    });
    return boxes;
  }

  async read(model: OcrModel, imagePath: string, crops: unknown[]) {
    await this.ensureLoaded(model);
    const { lines } = await this.request<{ lines: unknown[] }>("read", {
      model,
      image: imagePath,
      boxes: crops,
    });
    return lines;
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
   */
  async stop() {
    const child = this.child;
    if (!child) return;

    try {
      await this.request("shutdown");
    } catch {
      // It was already leaving, or already gone.
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
