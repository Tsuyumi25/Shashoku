import type { TranslateApi } from "@shared/ipc/channels";
import type { ShashokuApi } from "../../shared/ipc";

declare global {
  interface Window {
    /** 合併 API:翻譯 mode + 嵌字 mode,preload 一次暴露。 */
    api: TranslateApi & ShashokuApi;
  }
}

export {};
