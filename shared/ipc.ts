// main ↔ renderer 的協議:channel 名與跨界型別的唯一定義處。

// openImageFolder:嵌字 mode 的「開圖片資料夾」。翻譯 mode 的 openProjectFolder
// (@shared/ipc/channels)回傳路徑字串,是不同操作,合併 API 時改名區分。
export const CHANNELS = {
  openImageFolder: "project:openFolder",
  readImage: "project:readImage",
  ocrPage: "ocr:page",
  ocrStatus: "ocr:status",
  inpaintBlocks: "ocr:inpaint",
} as const;

export interface ProjectInfo {
  folder: string;
  images: string[]; // 檔名,自然排序 = 頁序
}

/** sidecar 回傳的一個偵測框(原圖 px)。text 只在文字類的框上有。 */
export interface OcrBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  label: "bubble" | "text_bubble" | "text_free";
  score: number;
  text?: string;
}

export interface OcrPageResult {
  width: number;
  height: number;
  blocks: OcrBlock[];
}

export interface OcrStatusEvent {
  state: "starting" | "loading" | "ready" | "error" | "stopped";
  detail?: string;
}

/** 去字補丁:RGBA PNG(mask 外 alpha=0),座標為原圖 px。 */
export interface InpaintPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  method: "fill" | "lama";
  png: string; // base64
}

export interface InpaintResult {
  patches: InpaintPatch[];
}

export interface ShashokuApi {
  openImageFolder(): Promise<ProjectInfo | null>;
  readImage(folder: string, name: string): Promise<Uint8Array>;
  ocrPage(folder: string, name: string): Promise<OcrPageResult>;
  inpaintBlocks(folder: string, name: string, blocks: OcrBlock[]): Promise<InpaintResult>;
  onOcrStatus(cb: (e: OcrStatusEvent) => void): void;
}
