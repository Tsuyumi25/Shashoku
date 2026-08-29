import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineLog, formatLogLine } from "./engineLog";

describe("formatLogLine", () => {
  it("stamps a line with an ISO timestamp", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    expect(formatLogLine("hello", now)).toBe("[2026-08-29T12:00:00.000Z] hello\n");
  });
});

describe("EngineLog", () => {
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs = [];
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "shashoku-engine-log-"));
    dirs.push(dir);
    return dir;
  }

  it("creates a missing log directory and writes timestamped lines", async () => {
    const dir = await tempDir();
    const path = join(dir, "nested", "sidecar.log");
    const log = new EngineLog(path);

    log.write("starting: interpreter=/usr/bin/python");
    log.write("spawned; treated as ready");
    await log.close();

    const content = await readFile(path, "utf8");
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] starting: interpreter=\/usr\/bin\/python$/,
    );
    expect(lines[1]).toMatch(/spawned; treated as ready$/);
  });

  it("appends across multiple constructions rather than truncating", async () => {
    const dir = await tempDir();
    const path = join(dir, "sidecar.log");

    const first = new EngineLog(path);
    first.write("first run");
    await first.close();

    const second = new EngineLog(path);
    second.write("second run");
    await second.close();

    const content = await readFile(path, "utf8");
    expect(content).toContain("first run");
    expect(content).toContain("second run");
  });

  it("does not throw when the directory cannot be created", async () => {
    const dir = await tempDir();
    // A file sitting where a directory needs to go: mkdir(recursive) cannot
    // walk through it.
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "not a directory");
    const path = join(blocker, "sub", "sidecar.log");

    expect(() => new EngineLog(path)).not.toThrow();
    const log = new EngineLog(path);
    expect(() => log.write("should be swallowed")).not.toThrow();
    await log.close();
  });

  it("does not throw when the file itself cannot be opened", async () => {
    const dir = await tempDir();
    // The path exists, but as a directory — opening it for append fails
    // asynchronously (EISDIR) rather than at construction time.
    const path = join(dir, "actually-a-dir");
    await mkdir(path);

    const log = new EngineLog(path);
    expect(() => log.write("first")).not.toThrow();
    // Give the async open() a turn to fail and fire the error handler.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(() => log.write("after the async failure")).not.toThrow();
    await log.close();
  });
});
