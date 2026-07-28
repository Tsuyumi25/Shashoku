import type { ScannedScanPoint } from "../project/library";

export const CHANNELS = {
  pickRoot: "shashoku:pick-root",
  pickFontFolder: "fonts:pick-folder",
  pickLibraryFolder: "shashoku:pick-library-folder",
  scanRoot: "shashoku:scan-root",
  scanLibrary: "shashoku:scan-library",
  createProject: "shashoku:create-project",
  importPages: "shashoku:import-pages",
  openProject: "shashoku:open-project",
  readPage: "shashoku:read-page",
  writePage: "shashoku:write-page",
  writeProjectMeta: "shashoku:write-project-meta",
  writeExport: "shashoku:write-export",
  openExportFolder: "shashoku:open-export-folder",
  readImage: "project:readImage",
  readThumbnail: "thumbnails:read",
  writeThumbnail: "thumbnails:write",
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
  /** A folder that already holds projects, to be listed and never written to. */
  pickLibraryFolder(): Promise<string | null>;
  scanRoot(rootPath: string): Promise<ScanRootResult>;
  /** What each scan point holds today, sentinel-bearing children only. */
  scanLibrary(scanPoints: string[]): Promise<ScannedScanPoint[]>;
  createProject(rootPath: string): Promise<OpenProjectResult>;
  importPages(rootPath: string, filenames: string[]): Promise<OpenProjectResult>;
  openProject(rootPath: string): Promise<OpenProjectResult>;
  readPage(pageDir: string): Promise<PageRawData>;
  writePage(pageDir: string, input: WritePageInput): Promise<void>;
  writeProjectMeta(shashokuDir: string, projectMetaRaw: string): Promise<void>;
  /** One delivered page, into `<rootPath>/export/<profileFolder>/`. */
  writeExport(
    rootPath: string,
    profileFolder: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<void>;
  /**
   * Shows a profile's delivery folder in the desktop's file manager, falling
   * back to the nearest folder above it that exists. Resolves to "" on
   * success, or to the platform's reason for refusing.
   */
  openExportFolder(rootPath: string, profileFolder: string): Promise<string>;
  readImage(folder: string, name: string): Promise<Uint8Array>;
  /**
   * A composited page held outside the project folder, keyed by a digest of
   * everything that went into drawing it. null means it has to be drawn.
   */
  readThumbnail(key: string): Promise<Uint8Array | null>;
  writeThumbnail(key: string, bytes: Uint8Array): Promise<void>;
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
