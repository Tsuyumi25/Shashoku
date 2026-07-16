// main ↔ renderer 的協議:channel 名與跨界型別的唯一定義處。

export const CHANNELS = {
  openProjectFolder: "project:openFolder",
  readImage: "project:readImage",
  ocrPage: "ocr:page",
  ocrStatus: "ocr:status",
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

export interface ShashokuApi {
  openProjectFolder(): Promise<ProjectInfo | null>;
  readImage(folder: string, name: string): Promise<Uint8Array>;
  ocrPage(folder: string, name: string): Promise<OcrPageResult>;
  onOcrStatus(cb: (e: OcrStatusEvent) => void): void;
}
