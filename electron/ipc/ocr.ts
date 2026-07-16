import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  CHANNELS,
  type InpaintResult,
  type OcrBlock,
  type OcrPageResult,
  type OcrStatusEvent,
} from "../../shared/ipc";

interface Pending {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
}

/**
 * OCR sidecar 管理:惰性啟動 ocr-sidecar/sidecar.py,stdio 行式 JSON 協議。
 * 模型載入(首次含下載)只發生一次;之後每個請求走同一進程。請求依序送出,
 * sidecar 端本來就是單執行緒逐條處理。
 */
class OcrSidecar {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;

  private broadcast(e: OcrStatusEvent) {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(CHANNELS.ocrStatus, e);
    }
  }

  private ensureStarted(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolveReady, rejectReady) => {
      const root = app.getAppPath(); // dev 下 = 專案根
      const python =
        process.env.SHASHOKU_PYTHON ?? join(root, "ocr-sidecar/.venv/bin/python");
      const script = join(root, "ocr-sidecar/sidecar.py");

      this.broadcast({ state: "starting" });
      const proc = spawn(python, [script], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          HF_HUB_DISABLE_PROGRESS_BARS: "1",
          // NixOS:manylinux wheel(numpy 等)要系統 libz,nix-ld 的 lib 目錄提供
          LD_LIBRARY_PATH:
            process.env.NIX_LD_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? "",
        },
      });
      this.proc = proc;
      let ready = false;

      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg: {
          event?: string;
          detail?: string;
          id?: number;
          ok?: boolean;
          error?: string;
        };
        try {
          msg = JSON.parse(line);
        } catch {
          return; // 非協議行,忽略
        }
        if (msg.event) {
          if (msg.event === "ready") {
            ready = true;
            this.broadcast({ state: "ready" });
            resolveReady();
          } else {
            this.broadcast({ state: "loading", detail: msg.detail });
          }
          return;
        }
        const p = msg.id === undefined ? undefined : this.pending.get(msg.id);
        if (!p || msg.id === undefined) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg as never);
        else p.reject(new Error(msg.error ?? "sidecar error"));
      });

      createInterface({ input: proc.stderr }).on("line", (line) =>
        console.log("[ocr-sidecar]", line)
      );

      proc.on("error", (err) => {
        this.broadcast({ state: "error", detail: String(err) });
        if (!ready) rejectReady(err);
      });
      proc.on("exit", (code) => {
        this.broadcast({ state: ready ? "stopped" : "error", detail: `exit ${code}` });
        const err = new Error(`sidecar exited (${code})`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.proc = null;
        this.readyPromise = null;
        if (!ready) rejectReady(err);
      });
    });
    return this.readyPromise;
  }

  async request<T>(cmd: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureStarted();
    if (!this.proc) throw new Error("sidecar not running");
    const id = this.nextId++;
    const payload = JSON.stringify({ id, cmd, ...params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.proc!.stdin.write(payload);
    });
  }

  dispose() {
    this.proc?.kill();
  }
}

export function registerOcrHandlers() {
  const sidecar = new OcrSidecar();

  ipcMain.handle(
    CHANNELS.ocrPage,
    async (_e, folder: string, name: string): Promise<OcrPageResult> => {
      const res = await sidecar.request<OcrPageResult>("detect_ocr", {
        image: join(folder, name),
      });
      return { width: res.width, height: res.height, blocks: res.blocks };
    }
  );

  ipcMain.handle(
    CHANNELS.inpaintBlocks,
    async (_e, folder: string, name: string, blocks: OcrBlock[]): Promise<InpaintResult> => {
      const res = await sidecar.request<InpaintResult>("inpaint", {
        image: join(folder, name),
        blocks: blocks.map(({ x, y, w, h }) => ({ x, y, w, h })),
      });
      return { patches: res.patches };
    }
  );

  app.on("before-quit", () => sidecar.dispose());
}
