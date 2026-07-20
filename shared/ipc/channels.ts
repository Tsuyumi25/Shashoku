// IPC channel 名稱與 renderer 側 api 介面的唯一事實來源。
// preload(實作)、electron/ipc(handler)、src/types/ipc.d.ts(global 宣告)都 import 這裡。

export const CHANNELS = {
  // ── Shashoku 專案(root/ + root/shashoku/) ──
  pickRoot: 'shashoku:pick-root',
  scanRoot: 'shashoku:scan-root',
  createProject: 'shashoku:create-project',
  openProject: 'shashoku:open-project',
  readPage: 'shashoku:read-page',
  writePage: 'shashoku:write-page',
  writeProjectMeta: 'shashoku:write-project-meta',

  // ── 圖片 / OCR / 去字 ──
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

// ── Shashoku 專案相關型別 ──

/** 掃 root 資料夾的結果:給 UI 判斷「這是新專案還是既有專案」 */
export interface ScanRootResult {
  /** root 底下的原圖檔名(自然排序 = 頁序) */
  rootImages: string[]
  /** shashoku/ 資料夾是否存在 */
  hasShashokuDir: boolean
  /** shashoku/.shashoku-project sentinel 是否存在 */
  hasSentinel: boolean
}

/** 檔名對應的 raw ↔ page 配對狀態,可見化雲端截斷與手動變更 */
export type PageBadge = 'ok' | 'raw-missing' | 'page-missing'

/** projectStore 用的頁面條目:結合 raws/ 檔名與 pages/ 資料夾 */
export interface PageEntry {
  /** basename(含副檔名,例如 "001.png"),= raws/ 內的檔名 */
  filename: string
  /** pages/<basename-無副檔名>/ 的絕對路徑;若 badge === 'page-missing' 是預期的路徑但實際不存在 */
  pageDir: string
  badge: PageBadge
}

/** 打開既有專案的結果 */
export interface OpenProjectResult {
  /** project.json 原文(呼叫端自行 parse,方便錯誤處理集中) */
  projectMetaRaw: string
  pages: PageEntry[]
}

/** readPage 回傳:三個 JSON 原文;呼叫端各自 parse(對應 shared/page/schema.ts) */
export interface PageRawData {
  manifestRaw: string
  translationRaw: string
  /** 缺 ocr.json 是正常狀態(選用檔案) */
  ocrRaw: string | null
}

/** writePage 的輸入:三個 JSON 已序列化為字串;可選的 layer PNG bytes(檔名 → 內容) */
export interface WritePageInput {
  manifestRaw: string
  translationRaw: string
  ocrRaw?: string
  /** key = "background.png" 之類的檔名,value = PNG bytes;寫入 pages/<n>/layers/<key> */
  layerParts?: Record<string, Uint8Array>
}

// ── 圖片 / OCR / 去字相關型別 ──

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
  // Shashoku 專案
  /** 資料夾對話框選 root;取消回傳 null */
  pickRoot(): Promise<string | null>
  /** 掃 root:回傳原圖清單 + shashoku/ 現況 */
  scanRoot(rootPath: string): Promise<ScanRootResult>
  /** 建立新專案:mkdir shashoku/{raws,pages,fonts} + 寫 sentinel/project.json + 複製原圖到 raws/ + 每頁空 manifest+translation */
  createProject(rootPath: string): Promise<OpenProjectResult>
  /** 打開既有專案:讀 project.json 內容 + 掃 raws/pages 做 badge 對帳 */
  openProject(rootPath: string): Promise<OpenProjectResult>
  /** 讀一頁的三個 JSON 原文 */
  readPage(pageDir: string): Promise<PageRawData>
  /** 寫一頁:按「manifest 最後寫」順序 layers/*.png → translation.json → manifest.json */
  writePage(pageDir: string, input: WritePageInput): Promise<void>
  /** 更新專案 metadata */
  writeProjectMeta(shashokuDir: string, projectMetaRaw: string): Promise<void>

  // 圖片 / OCR / 去字
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
