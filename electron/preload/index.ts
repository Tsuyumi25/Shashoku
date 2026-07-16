// POC 階段 renderer 只用瀏覽器 API(file input / canvas / blob),不需要跨行程橋接。
// 之後要接原生檔案對話框、字型枚舉時,再在這裡 contextBridge.exposeInMainWorld。
export {};
