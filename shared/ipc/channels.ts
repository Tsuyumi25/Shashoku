export const CHANNELS = {
  pickRoot: "shashoku:pick-root",
  pickFontFolder: "fonts:pick-folder",
  scanRoot: "shashoku:scan-root",
  createProject: "shashoku:create-project",
  importPages: "shashoku:import-pages",
  openProject: "shashoku:open-project",
  readPage: "shashoku:read-page",
  writePage: "shashoku:write-page",
  writeProjectMeta: "shashoku:write-project-meta",
  readImage: "project:readImage",
  readPreferences: "preferences:read",
  writePreferences: "preferences:write",
  windowMinimize: "window:minimize",
  windowMaximize: "window:maximize",
  windowClose: "window:close",
  windowWillClose: "window:will-close",
  windowCloseReady: "window:close-ready",
} as const;

export interface ScanRootResult {
  rootImages: string[];
  hasShashokuDir: boolean;
  hasSentinel: boolean;
}

export type PageBadge = "ok" | "raw-missing" | "page-missing" | "damaged";

export interface PageEntry {
  filename: string;
  pageDir: string;
  badge: PageBadge;
}

export interface OpenProjectResult {
  projectMetaRaw: string;
  pages: PageEntry[];
}

export interface PageRawData {
  manifestRaw: string;
  translationRaw: string;
  ocrRaw: string | null;
}

export interface WritePageInput {
  manifestRaw?: string;
  translationRaw?: string;
  ocrRaw?: string;
  layerParts?: Record<string, Uint8Array>;
}

export interface ShashokuApi {
  pickRoot(): Promise<string | null>;
  pickFontFolder(): Promise<string | null>;
  scanRoot(rootPath: string): Promise<ScanRootResult>;
  createProject(rootPath: string): Promise<OpenProjectResult>;
  importPages(rootPath: string, filenames: string[]): Promise<OpenProjectResult>;
  openProject(rootPath: string): Promise<OpenProjectResult>;
  readPage(pageDir: string): Promise<PageRawData>;
  writePage(pageDir: string, input: WritePageInput): Promise<void>;
  writeProjectMeta(shashokuDir: string, projectMetaRaw: string): Promise<void>;
  readImage(folder: string, name: string): Promise<Uint8Array>;
  /** Raw preferences.json contents; "" on first run. */
  readPreferences(): Promise<string>;
  writePreferences(raw: string): Promise<void>;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  /**
   * The window is going away and is holding itself open for the answer.
   * Whatever still has to reach disk goes now, then windowCloseReady.
   */
  onWillClose(handler: () => void): void;
  windowCloseReady(): void;
}
