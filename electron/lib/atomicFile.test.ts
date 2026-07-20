import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomicFile";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "atomicFile-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("寫入後檔案存在且內容正確 (string overload)", async () => {
    const dest = join(workDir, "hello.txt");
    await writeFileAtomic(dest, "你好,寫植");
    expect(await readFile(dest, "utf8")).toBe("你好,寫植");
  });

  it("寫入後檔案存在且內容正確 (Uint8Array overload)", async () => {
    const dest = join(workDir, "bin.dat");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    await writeFileAtomic(dest, bytes);
    const readBack = await readFile(dest);
    expect(Array.from(readBack)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("覆寫既有檔案:成功時新內容取代舊內容", async () => {
    const dest = join(workDir, "overwrite.txt");
    await writeFile(dest, "舊版");
    await writeFileAtomic(dest, "新版");
    expect(await readFile(dest, "utf8")).toBe("新版");
  });

  it("rename 失敗時原檔內容不變 (destPath 是不存在的資料夾)", async () => {
    const originalPath = join(workDir, "keep.txt");
    await writeFile(originalPath, "原本的內容");
    // 目標路徑父資料夾不存在 → rename 會失敗
    const badDest = join(workDir, "nonexistent-dir", "target.txt");
    await expect(writeFileAtomic(badDest, "新的內容")).rejects.toThrow();
    // 原檔案應該完全沒被動到
    expect(await readFile(originalPath, "utf8")).toBe("原本的內容");
  });

  it("同 process 內併發呼叫同一 destPath:每個 caller 拿到獨立 tmp,不互相踩踏 (finding 1)", async () => {
    const dest = join(workDir, "concurrent.txt");
    // 10 個併發寫入同一目標。若 tmp 命名撞名,rename 會 ENOENT。
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => writeFileAtomic(dest, `payload-${i}`)),
    );
    for (const r of results) expect(r.status).toBe("fulfilled");
    // 最終內容一定是某個 payload(哪個是 last-writer 由 rename 排程決定)
    const content = await readFile(dest, "utf8");
    expect(content).toMatch(/^payload-\d$/);
    // 沒有 tmp 檔遺留
    const remaining = await import("node:fs/promises").then((m) =>
      m.readdir(workDir),
    );
    expect(remaining.every((n) => !n.includes(".tmp-"))).toBe(true);
  });

  it("處理較大的 bytes (幾 MB) 也能正確落地", async () => {
    const dest = join(workDir, "large.bin");
    const bytes = new Uint8Array(3 * 1024 * 1024); // 3 MB
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    await writeFileAtomic(dest, bytes);
    const info = await stat(dest);
    expect(info.size).toBe(bytes.length);
    const readBack = await readFile(dest);
    expect(readBack[0]).toBe(0);
    expect(readBack[255]).toBe(255);
    expect(readBack[bytes.length - 1]).toBe((bytes.length - 1) & 0xff);
  });
});
