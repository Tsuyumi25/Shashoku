// IPC channel 名稱與 renderer 側 api 介面的唯一事實來源。
// preload(實作)、electron/ipc(handler)、src/types/ipc.ts(global 宣告)都 import 這裡。

export const CHANNELS = {
  openProjectFolder: 'dialog:open-project-folder',
  openSskFile: 'dialog:open-ssk-file',
  listImages: 'project:list-images',
  listSskFiles: 'project:list-ssk-files',
  readSskFile: 'project:read-ssk-file',
  writeSskFile: 'project:write-ssk-file',
  saveSskAs: 'project:save-ssk-as',
  openHelp: 'app:open-help',
  windowMinimize: 'window-minimize',
  windowMaximize: 'window-maximize',
  windowClose: 'window-close',
  windowForceClose: 'window-force-close',
  closeRequested: 'window-close-requested',
} as const

export interface SskFileEntry {
  filename: string
  /** 絕對路徑 */
  path: string
}

export interface OpenedSskFile {
  /** 絕對路徑 */
  path: string
  filename: string
  /** 工程檔所在資料夾(= 圖片資料夾,零配置慣例) */
  dir: string
}

export interface TranslateApi {
  /** 開資料夾選擇對話框,回傳絕對路徑;取消回傳 null */
  openProjectFolder(): Promise<string | null>
  /** 列出資料夾內圖片檔名(basename,數字感知排序) */
  listImages(folderPath: string): Promise<string[]>
  /** 列出資料夾內 .ssk.json 工程檔 */
  listSskFiles(folderPath: string): Promise<SskFileEntry[]>
  /** 讀工程檔原文(UTF-8,保留 BOM 交給 parser 處理) */
  readSskFile(sskPath: string): Promise<string>
  /** 原子寫入工程檔(先寫 temp 再 rename) */
  writeSskFile(sskPath: string, content: string): Promise<void>
  /** 存新檔對話框 + 寫入,回傳絕對路徑;取消回傳 null */
  saveSskAs(defaultDir: string, suggestedName: string, content: string): Promise<string | null>
  /** 開 .ssk.json 選檔對話框;取消回傳 null */
  openSskFile(): Promise<OpenedSskFile | null>
  /** 用系統瀏覽器開說明頁 */
  openHelp(): void

  windowMinimize(): void
  windowMaximize(): void
  /** 請求關窗:main 會攔下並發 closeRequested 事件,由 renderer 決定 */
  windowClose(): void
  /** 跳過關窗攔截直接關(dirty 確認流程結束後呼叫) */
  windowForceClose(): void
  /** 訂閱關窗請求(視窗 X、Alt+F4、選單「結束」都會走到這) */
  onCloseRequested(callback: () => void): void
}
