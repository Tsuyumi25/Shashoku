import type { ScannedScanPoint } from "../project/library";
import type { McpQuery, McpReply } from "../mcp/types";

export const CHANNELS = {
  pickRoot: "shashoku:pick-root",
  pickFontFolder: "fonts:pick-folder",
  scanRoot: "shashoku:scan-root",
  listSources: "shashoku:list-sources",
  scanLibrary: "shashoku:scan-library",
  createProject: "shashoku:create-project",
  createPage: "shashoku:create-page",
  deletePage: "shashoku:delete-page",
  openProject: "shashoku:open-project",
  readPage: "shashoku:read-page",
  writePage: "shashoku:write-page",
  writeProjectMeta: "shashoku:write-project-meta",
  writeExport: "shashoku:write-export",
  openExportFolder: "shashoku:open-export-folder",
  openProjectFolder: "shashoku:open-project-folder",
  readImage: "project:readImage",
  readThumbnail: "thumbnails:read",
  writeThumbnail: "thumbnails:write",
  readPreferences: "preferences:read",
  writePreferences: "preferences:write",
  ocrModels: "ocr:models",
  ocrDetect: "ocr:detect",
  ocrRead: "ocr:read",
  ocrUnload: "ocr:unload",
  ocrStop: "ocr:stop",
  ocrStatus: "ocr:status",
  windowSetOverlay: "window:set-overlay",
  windowWillClose: "window:will-close",
  windowCloseReady: "window:close-ready",
  mcpQuery: "mcp:query",
  mcpReply: "mcp:reply",
} as const;

export interface ScanRootResult {
  hasShashokuDir: boolean;
  hasSentinel: boolean;
}

/**
 * One image sitting in the project folder, as the folder answers for it right
 * now. Nothing is kept between one of these and the next: this is a mirror of a
 * directory, so what it says goes stale the moment it is read and is re-read
 * rather than maintained.
 *
 * The write time and the size ride along because a thumbnail is keyed by them —
 * a file replaced under the same name has to stop showing the old picture.
 */
export interface SourceImage {
  name: string;
  /** Last write time, in milliseconds. */
  modified: number;
  size: number;
}

/**
 * Named one by one rather than lumped into "openable or not", because each has
 * its own answer: a missing page is one to drop from the list, a damaged one is
 * a file to look at.
 */
export type PageBadge = "ok" | "missing" | "damaged";

export interface PageEntry {
  /** What names this page for as long as it exists. */
  pageId: string;
  pageDir: string;
  badge: PageBadge;
}

export interface OpenProjectResult {
  projectMetaRaw: string;
  pages: PageEntry[];
}

export interface PageRawData {
  manifestRaw: string;
  ocrRaw: string | null;
}

export interface WritePageInput {
  manifestRaw?: string;
  ocrRaw?: string;
  layerParts?: Record<string, Uint8Array>;
}

export interface ShashokuApi {
  pickRoot(): Promise<string | null>;
  pickFontFolder(): Promise<string | null>;
  scanRoot(rootPath: string): Promise<ScanRootResult>;
  /**
   * Every image directly in the project folder. Deliberately not recursive: a
   * finished page written into a subfolder must never be offered back as
   * something to make a page from.
   */
  listSources(rootPath: string): Promise<SourceImage[]>;
  /** What each scan point holds today, sentinel-bearing children only. */
  scanLibrary(scanPoints: string[]): Promise<ScannedScanPoint[]>;
  createProject(rootPath: string): Promise<OpenProjectResult>;
  /**
   * One page, from one image in the project root, appended to the ones already
   * there. Answers with the name it was given.
   *
   * The one irreversible step and the only one that reads a source file: the
   * pixels are copied in, and from then on the project does not depend on the
   * folder they came from.
   *
   * One page per call rather than a batch, because a batch is minutes long on a
   * chapter and the caller is the one that has to say how far it has got and
   * stop when asked.
   */
  createPage(rootPath: string, sourceName: string): Promise<string>;
  /**
   * Takes a page's directory away. Resolves once it is really gone, which is
   * what lets the caller wait before dropping the page from its list — the
   * other order lets a page nobody could delete come back at the next open.
   */
  deletePage(rootPath: string, pageId: string): Promise<void>;
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
  /**
   * Shows the project's own folder — where its source images live — in the
   * desktop's file manager. Resolves to "" on success, or to the platform's
   * reason for refusing.
   */
  openProjectFolder(rootPath: string): Promise<string>;
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
  /**
   * Recolors the system-drawn window buttons. They are painted by Chromium
   * outside the DOM, so the theme cannot reach them through CSS.
   */
  windowSetOverlay(color: string, symbolColor: string): void;
  /**
   * The window is going away and is holding itself open for the answer.
   * Whatever still has to reach disk goes now, then windowCloseReady.
   */
  onWillClose(handler: () => void): void;
  windowCloseReady(): void;
  /**
   * The MCP endpoint asking the renderer, where the open project actually
   * lives. Answers go back through mcpReply carrying the question's id.
   */
  onMcpQuery(handler: (query: McpQuery) => void): void;
  mcpReply(reply: McpReply): void;
}
