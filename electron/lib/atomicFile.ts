import { open, rename } from "node:fs/promises";

/** Process 內單調遞增,保證同 process 併發呼叫拿到不同 tmp 檔名。
 * pid 只保護跨 process 撞名(多實例),counter 才保護同 process 內 race。 */
let tmpCounter = 0;

/**
 * 原子寫入單一檔案:先寫 tmp、fsync 落盤、close、rename 替換。
 * Crash 於中間 = 目標檔仍是舊內容(POSIX rename 是原子的)。
 *
 * 抽自舊 electron/ipc/ssk.ts 的 writeSskAtomic;差別是這版顯式
 * `handle.sync()` 保證位元組真的寫到磁碟(對雲端同步的 placeholder
 * 截斷、Electron main SIGKILL 等場景多一層防護)。
 *
 * 「manifest 最後寫」pattern 的組件:多檔一致性靠**呼叫順序**保證,
 * 每檔各自呼叫本函式即可,不需要跨檔 transaction。
 */
export async function writeFileAtomic(
  destPath: string,
  data: Uint8Array | string,
): Promise<void> {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const tmpPath = `${destPath}.tmp-${process.pid}-${++tmpCounter}`;
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, destPath);
}
