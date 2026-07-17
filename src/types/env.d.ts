/// <reference types="vite/client" />

// 專案自訂的環境變數(electron-vite:renderer 只吃 RENDERER_VITE_ / VITE_ 前綴)

interface ImportMetaEnv {
  /** dev 便利:啟動時自動開啟的 .ssk.json 工程檔絕對路徑(見 .env.example)。 */
  readonly RENDERER_VITE_DEV_PROJECT?: string;
}
