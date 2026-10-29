import type { ScannedScanPoint } from "../project/library";
import type { DirEntry, FolderContents, WorkspaceScan } from "../project/workspace";
import type { McpQuery, McpReply } from "../mcp/types";
import type { WallScene } from "../wall/scene";

export const CHANNELS = {
  pickRoot: "shashoku:pick-root",
  pickWorkspace: "shashoku:pick-workspace",
  pickFontFolder: "fonts:pick-folder",
  scanRoot: "shashoku:scan-root",
  scanLibrary: "shashoku:scan-library",
  scanWorkspaces: "shashoku:scan-workspaces",
  listInside: "shashoku:list-inside",
  describeFolders: "shashoku:describe-folders",
  createProject: "shashoku:create-project",
  createPage: "shashoku:create-page",
  openProject: "shashoku:open-project",
  readProjectMeta: "shashoku:read-project-meta",
  readPage: "shashoku:read-page",
  writePage: "shashoku:write-page",
  deleteLayerParts: "shashoku:delete-layer-parts",
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
  ocrReadPage: "ocr:read-page",
  ocrUnload: "ocr:unload",
  ocrStop: "ocr:stop",
  ocrStatus: "ocr:status",
  ocrProgress: "ocr:progress",
  inpaintErase: "inpaint:erase",
  windowSetOverlay: "window:set-overlay",
  windowWillClose: "window:will-close",
  windowCloseReady: "window:close-ready",
  windowCloseBusy: "window:close-busy",
  windowCloseFailed: "window:close-failed",
  mcpQuery: "mcp:query",
  mcpReply: "mcp:reply",
  mcpReady: "mcp:ready",
  wallOpen: "wall:open",
  wallState: "wall:state",
  wallScene: "wall:scene",
  wallSceneWanted: "wall:scene-wanted",
  wallReveal: "wall:reveal",
  wallSelect: "wall:select",
  wallBrush: "wall:brush",
  wallSelection: "wall:selection",
} as const;

export interface ScanRootResult {
  hasShashokuDir: boolean;
  hasSentinel: boolean;
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
  pickWorkspace(): Promise<string | null>;
  pickFontFolder(): Promise<string | null>;
  scanRoot(rootPath: string): Promise<ScanRootResult>;
  /** What each scan point holds today, sentinel-bearing children only. */
  scanLibrary(scanPoints: string[]): Promise<ScannedScanPoint[]>;
  scanWorkspaces(roots: string[]): Promise<WorkspaceScan>;
  listInside(path: string): Promise<FolderContents>;
  /** Each folder as a shelf card, in the order given. */
  describeFolders(paths: string[]): Promise<DirEntry[]>;
  createProject(rootPath: string): Promise<OpenProjectResult>;
  /**
   * One page, from one image in the project root. Answers with the name it
   * was given; where that name lands in `pages` is the caller's to write.
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
  openProject(rootPath: string): Promise<OpenProjectResult>;
  /**
   * A book's `project.json` on its own, for a caller working on a book that
   * is not the one loaded in the editor — the library, reading a book's page
   * order without opening it. null when the book has never been saved.
   */
  readProjectMeta(rootPath: string): Promise<string | null>;
  readPage(pageDir: string): Promise<PageRawData>;
  writePage(pageDir: string, input: WritePageInput): Promise<void>;
  /**
   * Removes named layer files from one page.
   *
   * A flush uses it to drop the version it just superseded, and only after the
   * manifest naming the new one is on disk — so at no moment does a manifest
   * name a file that is gone. The wide sweep of everything no manifest names
   * still happens at open, where there is no undo stack to reach past it.
   */
  deleteLayerParts(pageDir: string, filenames: string[]): Promise<void>;
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
   * Shows a folder in the desktop's file manager — a project's own, where its
   * source images live, or any folder the library tree is standing on.
   * Resolves to "" on success, or to the platform's reason for refusing.
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
  /** Draws this window's whole document larger or smaller, in Chromium's zoom steps. */
  setZoomLevel(level: number): void;
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
   * Still writing. The window's patience is a dead man's switch rather than a
   * deadline: a renderer that is wedged or gone must not hold a window open,
   * but one that is four seconds into a write on a slow disk is neither, and
   * a fixed grace period cannot tell those apart.
   */
  windowCloseBusy(): void;
  /**
   * The last writes did not land. Answers with what the user chose — `retry`
   * to go round again, `discard` to leave without them.
   */
  windowCloseFailed(): Promise<"retry" | "discard">;
  /**
   * The MCP endpoint asking the renderer, where the open project actually
   * lives. Answers go back through mcpReply carrying the question's id.
   */
  onMcpQuery(handler: (query: McpQuery) => void): void;
  mcpReply(reply: McpReply): void;
  /**
   * The renderer can answer from now on. Sent once the interface has mounted,
   * because a query is delivered rather than queued — one sent at a window
   * that has not attached its handler yet is simply gone.
   */
  mcpReady(): void;
  /** Opens the wall in a window of its own, or brings it forward if it is open. */
  wallOpen(): void;
  /** Told whenever the wall window comes or goes, so nothing is gathered for nobody. */
  onWallState(handler: (open: boolean) => void): void;
  /** The editor's side: the chapter as it now stands, for the wall to draw. */
  wallPublish(scene: WallScene): void;
  /** The wall has just loaded and has nothing yet; publish now. */
  onWallSceneWanted(handler: () => void): void;
  /** A piece on the wall was pointed at; show it where it stands. */
  onWallReveal(handler: (pageId: string, id: string) => void): void;
  /** The wall's side: ask for the scene, take it, and point back at a piece. */
  wallWantScene(): void;
  onWallScene(handler: (scene: WallScene) => void): void;
  wallReveal(pageId: string, id: string): void;
  /** The wall picked a bucket or a meaning; select those objects in the editor. */
  wallSelect(ids: string[]): void;
  onWallSelect(handler: (ids: string[]) => void): void;
  /** The wall loaded a meaning onto the tag brush. */
  wallBrush(tags: string[]): void;
  onWallBrush(handler: (tags: string[]) => void): void;
  /** The editor's selection, so the wall marks the pieces it holds. */
  wallPublishSelection(ids: string[]): void;
  onWallSelection(handler: (ids: string[]) => void): void;
}
