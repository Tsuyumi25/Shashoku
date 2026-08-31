


import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { ScannedProject, ScannedScanPoint } from "@shared/project/library";
import type {
  DirEntry,
  FolderContents,
  ScannedBook,
  ScannedCover,
  ScannedFolder,
  ShelfLeaf,
  WorkspaceScan,
} from "@shared/project/workspace";
import type {
  OpenProjectResult,
  PageBadge,
  PageEntry,
  PageRawData,
  ScanRootResult,
  SourceImage,
  WritePageInput,
} from "@shared/ipc/channels";
import {
  DIR_LAYERS,
  DIR_PAGES,
  IMAGE_EXTENSIONS,
  PAGE_MANIFEST_FILENAME,
  PAGE_OCR_FILENAME,
  PROJECT_JSON_FILENAME,
  SENTINEL_FILENAME,
  SHASHOKU_DIR,
} from "@shared/ssk/constants";
import {
  defaultProjectJson,
  parseProjectJson,
  serializeProjectJson,
} from "@shared/project/schema";
import { pageDirName, reconcilePages } from "@shared/project/pages";
import {
  baseMapLayer,
  defaultManifest,
  generateId,
  parseManifest,
  serializeManifest,
} from "@shared/page/schema";
import { pageArtwork } from "@shared/page/tree";
import { DIR_EXPORT } from "@shared/export/types";
import { writeFileAtomic } from "./atomicFile";
import { importBaseMap } from "./engine";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listImages(folderPath: string): Promise<string[]> {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.includes(extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort(collator.compare);
  } catch {
    return [];
  }
}

async function listPageDirs(pagesRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(pagesRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(collator.compare);
  } catch {
    return [];
  }
}


async function manifestIsHealthy(pageDir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8");
    parseManifest(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * What each scan point holds right now. Answers for every point given, an
 * unreadable one included — a folder on a drive that is not mounted today is
 * empty rather than an error, so one missing disk does not take the whole
 * library down with it.
 */
export async function scanLibrary(scanPoints: string[]): Promise<ScannedScanPoint[]> {
  return Promise.all(
    scanPoints.map(async (point) => ({
      path: point,
      projects: await projectsUnder(point),
    })),
  );
}

async function projectsUnder(folderPath: string): Promise<ScannedProject[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e): Promise<ScannedProject | null> => {
        const path = join(folderPath, e.name);
        if (!(await isProject(path))) return null;
        return { path, cover: (await readBook(path)).cover?.file ?? null };
      }),
  );
  return found.filter((p): p is ScannedProject => p !== null);
}

async function isProject(path: string): Promise<boolean> {
  return await exists(join(path, SHASHOKU_DIR, SENTINEL_FILENAME));
}

async function coverAt(dir: string, file: string): Promise<ScannedCover | null> {
  try {
    const s = await stat(join(dir, file));
    return { dir, file, modified: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

async function livePages(rootPath: string): Promise<{ pagesRoot: string; live: string[] }> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  let listed: string[] = [];
  let deleted = new Set<string>();
  try {
    const raw = await readFile(join(shashokuDir, PROJECT_JSON_FILENAME), "utf8");
    const meta = parseProjectJson(raw);
    listed = meta.pages;
    deleted = new Set(meta.deletedPages ?? []);
  } catch {
  }
  const { order } = reconcilePages(listed, await listPageDirs(pagesRoot));
  return { pagesRoot, live: order.filter((pageId) => !deleted.has(pageId)) };
}

function artworkPath(pageId: string, file: string): string {
  return `${SHASHOKU_DIR}/${DIR_PAGES}/${pageId}/${DIR_LAYERS}/${file}`;
}

async function readBook(rootPath: string): Promise<Omit<ScannedBook, "path">> {
  const { pagesRoot, live } = await livePages(rootPath);
  for (const pageId of live) {
    let layers;
    try {
      const raw = await readFile(join(pagesRoot, pageId, PAGE_MANIFEST_FILENAME), "utf8");
      layers = parseManifest(raw).layers;
    } catch {
      continue;
    }
    const bottom = pageArtwork(layers);
    if (bottom) {
      const cover = await coverAt(rootPath, artworkPath(pageId, bottom.file));
      return { cover, pageCount: live.length };
    }
  }
  return { cover: null, pageCount: live.length };
}

export async function listInside(path: string): Promise<FolderContents> {
  const book = await isProject(path);
  const [pages, entries] = await Promise.all([
    book ? pagesInside(path) : Promise.resolve<ShelfLeaf[]>([]),
    entriesInside(path),
  ]);
  return { book, pages, entries };
}

async function entriesInside(path: string): Promise<DirEntry[]> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = await Promise.all(
    dirents.map(async (e): Promise<DirEntry> => {
      const child = join(path, e.name);
      if (!e.isDirectory()) {
        const image = IMAGE_EXTENSIONS.includes(extname(e.name).toLowerCase());
        return {
          name: e.name,
          path: child,
          folder: false,
          book: false,
          own: false,
          cover: image ? await coverAt(path, e.name) : null,
          pageCount: null,
          books: null,
        };
      }
      const book = await isProject(child);
      const read = book ? await readBook(child) : null;
      return {
        name: e.name,
        path: child,
        folder: true,
        book,
        own: e.name === SHASHOKU_DIR,
        cover: read ? read.cover : await firstPictureIn(child),
        pageCount: read ? read.pageCount : null,
        books: null,
      };
    }),
  );
  return entries.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

async function firstPictureIn(dir: string): Promise<ScannedCover | null> {
  if (await isProject(dir)) return (await readBook(dir)).cover;
  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const images = dirents
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.includes(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(collator.compare);
  if (images.length > 0) return await coverAt(dir, images[0]);

  const below = dirents
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(collator.compare);
  for (const name of below) {
    const found = await firstPictureIn(join(dir, name));
    if (found) return found;
  }
  return null;
}

async function pagesInside(rootPath: string): Promise<ShelfLeaf[]> {
  const { pagesRoot, live } = await livePages(rootPath);
  return await Promise.all(
    live.map(async (pageId): Promise<ShelfLeaf> => {
      try {
        const raw = await readFile(join(pagesRoot, pageId, PAGE_MANIFEST_FILENAME), "utf8");
        const manifest = parseManifest(raw);
        const bottom = pageArtwork(manifest.layers);
        return {
          id: pageId,
          name: manifest.name,
          cover: bottom ? await coverAt(rootPath, artworkPath(pageId, bottom.file)) : null,
          page: true,
        };
      } catch {
        return { id: pageId, name: pageId, cover: null, page: true };
      }
    }),
  );
}

/**
 * ⚠️ `Dirent.isDirectory` answers false for a link to a directory, so the
 * filter below is what keeps the walk out of a cycle.
 */
export async function scanWorkspaces(roots: readonly string[]): Promise<WorkspaceScan> {
  const seen = new Map<string, ScannedCover | null>();
  const folders: ScannedFolder[] = [];
  const books: ScannedBook[] = [];
  const kept: string[] = [];
  for (const root of roots) {
    const path = resolve(root);
    if (seen.has(path)) continue;
    kept.push(path);
    await walkInto(path, seen, folders, books);
  }
  return { roots: kept, folders, books };
}

async function walkInto(
  path: string,
  seen: Map<string, ScannedCover | null>,
  folders: ScannedFolder[],
  books: ScannedBook[],
): Promise<ScannedCover | null> {
  const already = seen.get(path);
  if (already !== undefined) return already;
  seen.set(path, null);

  if (await isProject(path)) {
    const book: ScannedBook = { path, ...(await readBook(path)) };
    books.push(book);
    seen.set(path, book.cover);
    return book.cover;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    folders.push({ path, cover: null });
    return null;
  }

  const images = entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.includes(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(collator.compare);
  let cover = images.length > 0 ? await coverAt(path, images[0]) : null;

  const below = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(collator.compare);
  const covers = await Promise.all(
    below.map((name) => walkInto(join(path, name), seen, folders, books)),
  );
  if (cover === null) cover = covers.find((c) => c !== null) ?? null;

  folders.push({ path, cover });
  seen.set(path, cover);
  return cover;
}

export async function scanRoot(rootPath: string): Promise<ScanRootResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const hasShashokuDir = await exists(shashokuDir);
  const hasSentinel = hasShashokuDir ? await exists(join(shashokuDir, SENTINEL_FILENAME)) : false;
  return { hasShashokuDir, hasSentinel };
}

/**
 * The project folder as it stands, images only and one level deep.
 *
 * Costs one readdir plus a stat per file — a fifth of a millisecond for a real
 * two-hundred-page chapter, because none of it touches file contents. That is
 * what lets the panel showing this keep nothing and simply ask again.
 */
export async function listSources(rootPath: string): Promise<SourceImage[]> {
  const names = await listImages(rootPath);
  const found = await Promise.all(
    names.map(async (name): Promise<SourceImage | null> => {
      try {
        const s = await stat(join(rootPath, name));
        return { name, modified: s.mtimeMs, size: s.size };
      } catch {
        // Listed a moment ago and gone now, which is the ordinary race a mirror
        // of a directory lives with. It is simply not in this answer.
        return null;
      }
    }),
  );
  return found.filter((s): s is SourceImage => s !== null);
}

/**
 * The project's pages, in the order the document gives and with what the disk
 * has to say about each.
 *
 * The list decides who comes before whom; the directory decides who exists. The
 * order that comes back has already taken in anything the list did not mention,
 * so a page that arrived behind the program's back is a page rather than a
 * file nobody can reach.
 */
async function buildOpenResult(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const pagesRoot = join(shashokuDir, DIR_PAGES);

  const projectMetaRaw = await readFile(join(shashokuDir, PROJECT_JSON_FILENAME), "utf8");
  const listed = parseProjectJson(projectMetaRaw).pages;
  const { order, missing } = reconcilePages(listed, await listPageDirs(pagesRoot));
  const isMissing = new Set(missing);

  const pages: PageEntry[] = [];
  for (const pageId of order) {
    const pageDir = join(pagesRoot, pageId);
    let badge: PageBadge;
    if (isMissing.has(pageId)) badge = "missing";
    else badge = (await manifestIsHealthy(pageDir)) ? "ok" : "damaged";
    pages.push({ pageId, pageDir, badge });
  }

  return { projectMetaRaw, pages };
}

/**
 * One page, made from one source image. The manifest goes last for the reason
 * it always does: it names the layer file, so writing it after the pixels means
 * a crash in between leaves a directory with no manifest rather than a page
 * pointing at something that is not there.
 *
 * The directory is taken away again if anything fails, because an empty one
 * would be adopted at the next open and shown as a damaged page — a fault
 * invented by the failure rather than reported by it.
 */
async function makePage(
  rootPath: string,
  pagesRoot: string,
  sourceName: string,
  pageId: string,
): Promise<void> {
  const pageDir = join(pagesRoot, pageId);
  const layersDir = join(pageDir, DIR_LAYERS);
  await mkdir(layersDir, { recursive: true });
  try {
    const file = `${generateId()}.png`;
    const { width, height } = await importBaseMap(
      join(rootPath, sourceName),
      join(layersDir, file),
    );
    const manifest = defaultManifest(sourceName, width, height);
    manifest.layers = [baseMapLayer(file, width, height)];
    await writeFileAtomic(join(pageDir, PAGE_MANIFEST_FILENAME), serializeManifest(manifest));
  } catch (err) {
    await rm(pageDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * One page, from one image in the project root. Answers with the name it was
 * given, and nothing more — where it lands in `pages` is the caller's to
 * decide and write, not this function's.
 *
 * One page per call rather than a batch: a chapter takes minutes, and the
 * caller is the one that can say how far it has got and stop when asked.
 *
 * Nothing is written to the page list here, on purpose: a directory this
 * makes and a name written into `pages` are the same page from two different
 * places, and only one of them can crash independently of the other.
 * `reconcilePages` adopting an unlisted directory at the next open is what
 * still happens if the caller's own write never lands — a page made and then
 * lost to a crash before its name reaches `pages` is not invented by that
 * adoption, only found by it, at the end of the order rather than wherever it
 * was meant to land.
 */
export async function createPage(rootPath: string, sourceName: string): Promise<string> {
  const pagesRoot = join(rootPath, SHASHOKU_DIR, DIR_PAGES);
  const pageId = pageDirName(sourceName, new Date(), new Set(await listPageDirs(pagesRoot)));
  await makePage(rootPath, pagesRoot, sourceName, pageId);
  return pageId;
}

export async function createProject(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);

  await mkdir(join(shashokuDir, DIR_PAGES), { recursive: true });

  await writeFileAtomic(join(shashokuDir, SENTINEL_FILENAME), "shashoku\n");
  await writeFileAtomic(
    join(shashokuDir, PROJECT_JSON_FILENAME),
    serializeProjectJson(defaultProjectJson()),
  );

  // Deliberately empty. Reading a source image is irreversible and takes real
  // time, so it waits to be asked for — opening a folder is not asking.
  return await buildOpenResult(rootPath);
}

export async function openProject(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const pageDirs = await listPageDirs(pagesRoot);
  for (const pageId of pageDirs) {
    await gcOrphanLayers(join(pagesRoot, pageId));
  }
  return await buildOpenResult(rootPath);
}


async function gcOrphanLayers(pageDir: string): Promise<void> {
  const layersDir = join(pageDir, DIR_LAYERS);
  if (!(await exists(layersDir))) return;
  let referenced: Set<string>;
  try {
    const manifestRaw = await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8");
    
    
    const files: string[] = [];
    const collect = (entries: import("@shared/page/types").LayerEntry[]): void => {
      for (const e of entries) {
        if (e.kind === "raster") files.push(e.file);
        else if (e.kind === "group") collect(e.children);
      }
    };
    collect(parseManifest(manifestRaw).layers);
    referenced = new Set(files);
  } catch {
    
    return;
  }
  const entries = await readdir(layersDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (referenced.has(e.name)) continue;
    
    await unlink(join(layersDir, e.name)).catch(() => {
      
    });
  }
}

/**
 * Removes named layer files. The one deletion that happens while a project is
 * open, and the only one narrow enough to be safe there.
 *
 * A flush uses it to drop the version it just superseded, and only after the
 * manifest naming the new one is on disk — so at no moment does a manifest name
 * a file that is gone. The wide sweep still belongs at open, where there is no
 * undo stack to reach past the manifest.
 *
 * Missing is not an error: two flushes racing on the same layer would otherwise
 * make the loser throw over work that is already done.
 */
export async function deleteLayerParts(
  pageDir: string,
  filenames: readonly string[],
): Promise<void> {
  const layersDir = join(pageDir, DIR_LAYERS);
  for (const filename of filenames) {
    assertPathSegment(filename, "layer 檔名");
    await unlink(join(layersDir, filename)).catch(() => {});
  }
}

export async function readPage(pageDir: string): Promise<PageRawData> {
  const manifestRaw = await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8");
  const ocrPath = join(pageDir, PAGE_OCR_FILENAME);
  const ocrRaw = (await exists(ocrPath)) ? await readFile(ocrPath, "utf8") : null;
  return { manifestRaw, ocrRaw };
}

/**
 * The manifest goes last, always. It is the page's commit anchor: it holds the
 * text and names the layer files, so as long as it is written after everything
 * it refers to, a crash mid-write leaves the previous manifest pointing at
 * data that is all still there.
 */
export async function writePage(pageDir: string, input: WritePageInput): Promise<void> {
  await mkdir(pageDir, { recursive: true });

  if (input.layerParts && Object.keys(input.layerParts).length > 0) {
    const layersDir = join(pageDir, DIR_LAYERS);
    await mkdir(layersDir, { recursive: true });
    for (const [filename, bytes] of Object.entries(input.layerParts)) {
      if (/[\\/]/.test(filename)) {
        throw new Error(`layer 檔名不可含路徑分隔符:${filename}`);
      }
      await writeFileAtomic(join(layersDir, filename), bytes);
    }
  }

  if (input.ocrRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_OCR_FILENAME), input.ocrRaw);
  }
  if (input.manifestRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_MANIFEST_FILENAME), input.manifestRaw);
  }
}

/**
 * One delivered page.
 *
 * Never the project root, and not for tidiness: listImages reads the root
 * without recursing, so a finished page written beside the source images would
 * be offered back as a source to make a page from — and making one would
 * typeset the text a second time onto text already burnt in. Any subfolder is
 * safe, which is why every profile has one.
 */
export async function writeExport(
  rootPath: string,
  profileFolder: string,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  assertPathSegment(profileFolder, "設定檔資料夾");
  assertPathSegment(filename, "檔名");
  const dir = join(rootPath, DIR_EXPORT, profileFolder);
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(join(dir, filename), bytes);
}

/**
 * Where one profile delivers, or the nearest folder above it that exists.
 *
 * A project that has never been exported has no such folder yet, and a button
 * that only works after the first export is a button that mostly does not. The
 * project's own folder is always there, so the walk always lands somewhere the
 * user recognizes.
 */
export async function resolveExportFolder(
  rootPath: string,
  profileFolder: string,
): Promise<string> {
  assertPathSegment(profileFolder, "設定檔資料夾");
  const candidates = [
    join(rootPath, DIR_EXPORT, profileFolder),
    join(rootPath, DIR_EXPORT),
    rootPath,
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return rootPath;
}

/**
 * One level of the path, and only one. The naming rule's prefix and suffix are
 * user-entered and end up inside a filename, so the check is repeated here at
 * the point of the write rather than trusted to have happened upstream.
 */
export function assertPathSegment(part: string, label: string): void {
  if (part.length === 0 || /[\\/]/.test(part) || part === "." || part === "..") {
    throw new Error(`${label}不可為空、不可含路徑分隔符,也不可是 . 或 ..:${part}`);
  }
}

export async function writeProjectMeta(
  shashokuDir: string,
  projectMetaRaw: string,
): Promise<void> {
  await writeFileAtomic(join(shashokuDir, PROJECT_JSON_FILENAME), projectMetaRaw);
}

/**
 * A book's `project.json`, read on its own rather than through `openProject`
 * — for a caller that wants a book's page order and tags without taking on
 * everything opening does: reading every manifest, reconciling the page
 * list, sweeping orphan layers.
 *
 * null rather than thrown for a book that has never been saved, or whose
 * file cannot be read — the caller already knows how to start one from
 * `defaultProjectJson()`, the same way a fresh project does.
 */
export async function readProjectMeta(rootPath: string): Promise<string | null> {
  try {
    return await readFile(join(rootPath, SHASHOKU_DIR, PROJECT_JSON_FILENAME), "utf8");
  } catch {
    return null;
  }
}
