// IPC channel 名稱與 renderer 側 api 介面的唯一事實來源。
// preload(實作)、electron/ipc(handler)、src/types/ipc.ts(global 宣告)都 import 這裡。

export const CHANNELS = {
  // ── 專案:.ssk.json 工程檔(翻譯 mode) ──
  openProjectFolder: 'dialog:open-project-folder',
  openSskFile: 'dialog:open-ssk-file',
  listImages: 'project:list-images',
  listSskFiles: 'project:list-ssk-files',
  readSskFile: 'project:read-ssk-file',
  writeSskFile: 'project:write-ssk-file',
  saveSskAs: 'project:save-ssk-as',

  // ── 圖片 / OCR / 去字(嵌字 mode) ──
  openImageFolder: 'project:openFolder',
  readImage: 'project:readImage',
  ocrPage: 'ocr:page',
  ocrStatus: 'ocr:status',
  inpaintBlocks: 'ocr:inpaint',

  // ── 字體 ──
  pickFontFolder: 'fonts:pickFolder',
  scanFontFolder: 'fonts:scan',
  listFontFolders: 'fonts:listFolders',
  setFontFolders: 'fonts:setFolders',

  // ── app / 視窗 ──
  openHelp: 'app:open-help',
  windowMinimize: 'window-minimize',
  windowMaximize: 'window-maximize',
  windowClose: 'window-close',
  windowForceClose: 'window-force-close',
  openTextBoard: 'window-open-text-board',
  closeRequested: 'window-close-requested',
} as const

export type WindowRole = 'main' | 'text-board'

// ── 專案(.ssk.json)相關型別 ──

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

// ── 圖片資料夾 / OCR / 去字相關型別 ──

export interface ProjectInfo {
  folder: string
  images: string[] // 檔名,自然排序 = 頁序
}

/** sidecar 回傳的一個偵測框(原圖 px)。text 只在文字類的框上有。 */
export interface OcrBlock {
  x: number
  y: number
  w: number
  h: number
  label: 'bubble' | 'text_bubble' | 'text_free'
  score: number
  text?: string
}

export interface OcrPageResult {
  width: number
  height: number
  blocks: OcrBlock[]
}

export interface OcrStatusEvent {
  state: 'starting' | 'loading' | 'ready' | 'error' | 'stopped'
  detail?: string
}

/** 去字補丁:RGBA PNG(mask 外 alpha=0),座標為原圖 px。 */
export interface InpaintPatch {
  x: number
  y: number
  w: number
  h: number
  method: 'fill' | 'lama'
  png: string // base64
}

export interface InpaintResult {
  patches: InpaintPatch[]
}

// ── 字體相關型別 ──

/** 字體檔 name table 解析出的一個 face 的名稱組 */
export interface FontFaceName {
  family: string
  fullName: string
  postscriptName: string
}

/** 資料夾掃描結果的一個字體檔。ttc 集合檔 faces 會有多個。 */
export interface ScannedFontFile {
  path: string
  faces: FontFaceName[]
}

// ── renderer 側 API 介面 ──

export interface ShashokuApi {
  // 專案(翻譯 mode)
  openProjectFolder(): Promise<string | null>
  listImages(folderPath: string): Promise<string[]>
  listSskFiles(folderPath: string): Promise<SskFileEntry[]>
  readSskFile(sskPath: string): Promise<string>
  writeSskFile(sskPath: string, content: string): Promise<void>
  saveSskAs(defaultDir: string, suggestedName: string, content: string): Promise<string | null>
  openSskFile(): Promise<OpenedSskFile | null>

  // 圖片 / OCR / 去字(嵌字 mode)
  openImageFolder(): Promise<ProjectInfo | null>
  readImage(folder: string, name: string): Promise<Uint8Array>
  ocrPage(folder: string, name: string): Promise<OcrPageResult>
  inpaintBlocks(folder: string, name: string, blocks: OcrBlock[]): Promise<InpaintResult>
  onOcrStatus(cb: (e: OcrStatusEvent) => void): void

  // 字體
  pickFontFolder(): Promise<string | null>
  scanFontFolder(folder: string): Promise<ScannedFontFile[]>
  listFontFolders(): Promise<string[]>
  /** 持久化 + 重寫 app 私有 fonts.conf;重啟後 fontconfig 生效 */
  setFontFolders(folders: string[]): Promise<void>

  // app / 視窗
  openHelp(): void
  windowMinimize(): void
  windowMaximize(): void
  /** 請求關窗:main 會攔下並發 closeRequested 事件,由 renderer 決定 */
  windowClose(): void
  /** 跳過關窗攔截直接關(dirty 確認流程結束後呼叫) */
  windowForceClose(): void
  /** 開啟或聚焦唯一的文字物件畫布 */
  openTextBoard(): void
  /** 訂閱關窗請求(視窗 X、Alt+F4、選單「結束」都會走到這) */
  onCloseRequested(callback: () => void): void
}
