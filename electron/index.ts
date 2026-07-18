import { app, BrowserWindow, Menu } from "electron";
import { registerDialogHandlers } from "./ipc/dialog";
import { registerSskHandlers } from "./ipc/ssk";
import { registerOcrHandlers } from "./ipc/ocr";
import { registerProjectHandlers } from "./ipc/project";
import { registerWindowControlHandlers } from "./ipc/windowControls";
import { handleLocalFileProtocol, registerLocalFileScheme } from "./protocol";
import { createWindow } from "./window";

// 單實例(桌面應用慣例:再次啟動 = 喚起既有視窗)。同時根絕多實例共搶
// userData 的問題——Chromium 沒設計成多進程共用同一 profile,兩個實例
// 併發開 Local Storage 會鎖競爭到秒級(electron#24441)。鎖帶 PID 與
// stale 檢測,持有者死掉後下一個實例自動接管
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

// 移除預設應用選單:Alt 不再 focus 選單列(PS 手感,Alt 是修飾鍵不是選單鍵),
// 選單加速鍵也不再攔截頁面快捷鍵(Ctrl+Shift+I 曾被 DevTools 加速鍵吃掉)。
// 代價:DevTools/Reload 的內建加速鍵消失,由 window.ts 在 dev 模式補 F12/Ctrl+R。
Menu.setApplicationMenu(null);

// HTML-in-Canvas(drawElementImage,Chromium 150 DevTrial):匯出管線把
// DOM 排版的標籤文字畫進 canvas 合成——「軟體內 = 匯出」的所見即所得。
// 已實測:直排 OK、不 taint。Electron 鎖定 Chromium 版本,實驗 API 的
// 變動風險由我們的升級時機控制。
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");

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
