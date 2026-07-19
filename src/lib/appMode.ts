import { ref } from "vue";

/**
 * 頂層工作模式(DaVinci Resolve 式頁面制):翻譯 = LP 血統的標記/譯文介面,
 * 嵌字 = 像素編輯器,校對 = 左原圖右成品的 compare 佈局,字體 = 全螢幕
 * 字體預覽揀選。各 mode 以 v-show 常駐(切換不丟狀態),因此各 mode 的
 * window 級鍵盤 handler 必須自行 guard `appMode.value`,否則 Q/W/E/R
 * (翻譯)與工具單鍵(嵌字)會互相打架。
 */
export type AppMode = "translate" | "letter" | "proofread" | "fonts";

export const appMode = ref<AppMode>("translate");
