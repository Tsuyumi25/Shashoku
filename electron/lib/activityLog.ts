import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

/**
 * Where the activity log goes: the machine's own data, never the project
 * folder, so handing a book to somebody does not hand them how it was made.
 * One file per local day, one JSON object per line.
 */
export function activityLogDir(): string {
  return join(app.getPath("userData"), "logs");
}

function fileFor(now: Date): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return join(activityLogDir(), `${day}.jsonl`);
}

/** Lines already joined and newline-terminated by the renderer. */
export async function appendActivity(lines: string): Promise<void> {
  if (lines.length === 0) return;
  await mkdir(activityLogDir(), { recursive: true });
  await appendFile(fileFor(new Date()), lines, "utf8");
}
