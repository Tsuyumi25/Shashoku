import { BrowserWindow, dialog, ipcMain } from "electron";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { CHANNELS, type SskFileEntry } from "@shared/ipc/channels";
import { IMAGE_EXTENSIONS, SSK_FILE_SUFFIX } from "@shared/ssk/constants";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function listByExtensions(folderPath: string, exts: string[]): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && exts.includes(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(collator.compare);
}

// 複合副檔名不能用 extname 判斷(它只認最後一段,會把一般 .json 誤收)
async function listSskFiles(folderPath: string): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(SSK_FILE_SUFFIX))
    .map((e) => e.name)
    .sort(collator.compare);
}

// 翻譯資料珍貴:先寫 temp 再 rename,寫壞時不毀原檔
async function writeSskAtomic(sskPath: string, content: string): Promise<void> {
  const tmpPath = `${sskPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, Buffer.from(content, "utf8"));
  await rename(tmpPath, sskPath);
}

export function registerSskHandlers(): void {
  ipcMain.handle(CHANNELS.listImages, (_e, folderPath: string) =>
    listByExtensions(folderPath, IMAGE_EXTENSIONS),
  );

  ipcMain.handle(CHANNELS.listSskFiles, async (_e, folderPath: string): Promise<SskFileEntry[]> => {
    const names = await listSskFiles(folderPath);
    return names.map((filename) => ({ filename, path: join(folderPath, filename) }));
  });

  ipcMain.handle(CHANNELS.readSskFile, (_e, sskPath: string) => readFile(sskPath, "utf8"));

  ipcMain.handle(CHANNELS.writeSskFile, (_e, sskPath: string, content: string) =>
    writeSskAtomic(sskPath, content),
  );

  ipcMain.handle(
    CHANNELS.saveSskAs,
    async (
      e,
      defaultDir: string,
      suggestedName: string,
      content: string,
    ): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return null;
      const result = await dialog.showSaveDialog(win, {
        title: "儲存工程檔",
        defaultPath: join(defaultDir, suggestedName),
        // Electron filter 不支援複合副檔名,只能寬鬆到 .json
        filters: [{ name: "Shashoku 工程檔", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeSskAtomic(result.filePath, content);
      return result.filePath;
    },
  );
}
