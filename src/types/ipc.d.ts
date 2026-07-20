import type { ShashokuApi } from "@shared/ipc/channels";

declare global {
  interface Window {
    /** 合併 API:翻譯 + 嵌字 + 字體 + 視窗,preload 一次暴露。 */
    api: ShashokuApi;
  }
}

export {};
