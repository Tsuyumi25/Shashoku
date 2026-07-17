import { BrowserWindow, dialog, ipcMain } from "electron";
import { basename, dirname } from "node:path";
import { CHANNELS, type OpenedSskFile } from "@shared/ipc/channels";
import { SSK_FILE_SUFFIX } from "@shared/ssk/constants";

export function registerDialogHandlers(): void {
  ipcMain.handle(CHANNELS.openProjectFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "選擇漫畫圖片資料夾",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.openSskFile, async (e): Promise<OpenedSskFile | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "開啟工程檔",
      properties: ["openFile"],
      // filter 只能寬鬆到 .json(不支援複合副檔名);選錯檔案由 parser 的驗證擋
      filters: [{ name: "Shashoku 工程檔", extensions: ["json"] }],
    });
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    if (!path.toLowerCase().endsWith(SSK_FILE_SUFFIX)) {
      // 提早給人話錯誤,而不是讓 JSON 結構驗證來報
      dialog.showErrorBox("不是工程檔", `請選擇 ${SSK_FILE_SUFFIX} 結尾的工程檔`);
      return null;
    }
    return { path, filename: basename(path), dir: dirname(path) };
  });
}
