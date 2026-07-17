import { app, Menu } from "electron";
import { registerDialogHandlers } from "./ipc/dialog";
import { registerSskHandlers } from "./ipc/ssk";
import { registerOcrHandlers } from "./ipc/ocr";
import { registerProjectHandlers } from "./ipc/project";
import { registerWindowControlHandlers } from "./ipc/windowControls";
import { handleLocalFileProtocol, registerLocalFileScheme } from "./protocol";
import { createWindow } from "./window";

// 移除預設應用選單:Alt 不再 focus 選單列(PS 手感,Alt 是修飾鍵不是選單鍵),
// 選單加速鍵也不再攔截頁面快捷鍵(Ctrl+Shift+I 曾被 DevTools 加速鍵吃掉)。
// 代價:DevTools/Reload 的內建加速鍵消失,由 window.ts 在 dev 模式補 F12/Ctrl+R。
Menu.setApplicationMenu(null);

registerLocalFileScheme();

app.whenReady().then(() => {
  handleLocalFileProtocol();
  registerWindowControlHandlers();
  registerDialogHandlers();
  registerSskHandlers();
  registerProjectHandlers();
  registerOcrHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
