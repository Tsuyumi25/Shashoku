import { open, rename } from "node:fs/promises";


let tmpCounter = 0;


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
