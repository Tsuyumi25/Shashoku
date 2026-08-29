import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

/**
 * Where the engine's own half of the story goes once there is no terminal
 * left to show it on — a packaged app has none, and that is exactly where
 * the interesting failures happen.
 */
export function engineLogPath(): string {
  return join(app.getPath("logs"), "sidecar.log");
}

export function formatLogLine(line: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] ${line}\n`;
}

/**
 * An append-only, best-effort record of the engine's stderr and lifecycle.
 *
 * Best-effort because a log that cannot be opened — missing directory, full
 * disk, no permission — must never be the reason the engine fails to start.
 * Every failure here, sync or async, is swallowed; a caller that only ever
 * calls `write` never needs to know whether the file exists.
 */
export class EngineLog {
  private stream: WriteStream | null = null;

  constructor(path: string = engineLogPath()) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const stream = createWriteStream(path, { flags: "a" });
      stream.on("error", () => {
        this.stream = null;
      });
      this.stream = stream;
    } catch {
      // No directory, no permission, whatever it is — console-only from here.
    }
  }

  write(line: string): void {
    this.stream?.write(formatLogLine(line));
  }

  /** Ends the underlying file cleanly. Resolves even if nothing was open. */
  close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return Promise.resolve();
    return new Promise((resolve) => stream.end(resolve));
  }
}
