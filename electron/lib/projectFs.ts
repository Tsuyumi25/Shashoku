


import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ScannedProject, ScannedScanPoint } from "@shared/project/library";
import type {
  OpenProjectResult,
  PageBadge,
  PageEntry,
  PageRawData,
  ScanRootResult,
  WritePageInput,
} from "@shared/ipc/channels";
import {
  DIR_FONTS,
  DIR_LAYERS,
  DIR_PAGES,
  DIR_RAWS,
  IMAGE_EXTENSIONS,
  PAGE_MANIFEST_FILENAME,
  PAGE_OCR_FILENAME,
  PROJECT_JSON_FILENAME,
  SENTINEL_FILENAME,
  SHASHOKU_DIR,
} from "@shared/ssk/constants";
import { defaultProjectJson, serializeProjectJson } from "@shared/project/schema";
import { defaultManifest, parseManifest, serializeManifest } from "@shared/page/schema";
import { DIR_EXPORT } from "@shared/export/types";
import { writeFileAtomic } from "./atomicFile";

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


function stemOf(filename: string): string {
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
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
        const shashokuDir = join(path, SHASHOKU_DIR);
        if (!(await exists(join(shashokuDir, SENTINEL_FILENAME)))) return null;
        const raws = await listImages(join(shashokuDir, DIR_RAWS));
        return { path, cover: raws[0] ?? null };
      }),
  );
  return found.filter((p): p is ScannedProject => p !== null);
}

export async function scanRoot(rootPath: string): Promise<ScanRootResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const [rootImages, hasShashokuDir] = await Promise.all([
    listImages(rootPath),
    exists(shashokuDir),
  ]);
  const hasSentinel = hasShashokuDir ? await exists(join(shashokuDir, SENTINEL_FILENAME)) : false;
  return { rootImages, hasShashokuDir, hasSentinel };
}

async function buildOpenResult(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const rawsDir = join(shashokuDir, DIR_RAWS);
  const pagesRoot = join(shashokuDir, DIR_PAGES);

  const projectMetaRaw = await readFile(join(shashokuDir, PROJECT_JSON_FILENAME), "utf8");

  const [rawFiles, pageDirs] = await Promise.all([listImages(rawsDir), listPageDirs(pagesRoot)]);

  
  
  const pageDirSet = new Set(pageDirs);
  const pages: PageEntry[] = [];
  const seenStems = new Set<string>();

  
  
  for (const filename of rawFiles) {
    const stem = stemOf(filename);
    seenStems.add(stem);
    const pageDir = join(pagesRoot, stem);
    let badge: PageBadge;
    if (!pageDirSet.has(stem)) {
      badge = "page-missing";
    } else if (await manifestIsHealthy(pageDir)) {
      badge = "ok";
    } else {
      badge = "damaged";
    }
    pages.push({ pageId: filename, pageDir, badge });
  }

  
  for (const stem of pageDirs) {
    if (seenStems.has(stem)) continue;
    pages.push({
      pageId: stem,
      pageDir: join(pagesRoot, stem),
      badge: "raw-missing",
    });
  }

  return { projectMetaRaw, pages };
}


async function initPageEntry(
  rootPath: string,
  shashokuDir: string,
  filename: string,
): Promise<void> {
  
  if (/[\\/]/.test(filename)) {
    throw new Error(`filename 不可含路徑分隔符:${filename}`);
  }
  const rawsDir = join(shashokuDir, DIR_RAWS);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const stem = stemOf(filename);
  const pageDir = join(pagesRoot, stem);
  
  if (await exists(pageDir)) {
    throw new Error(
      `頁面 stem 衝突:${filename} 對應的 pages/${stem}/ 已存在(可能有同 stem 不同副檔名的檔案,如 ${stem}.png 與 ${stem}.jpg)`,
    );
  }
  await copyFile(join(rootPath, filename), join(rawsDir, filename));
  await mkdir(pageDir, { recursive: true });
  await writeFileAtomic(
    join(pageDir, PAGE_MANIFEST_FILENAME),
    serializeManifest(defaultManifest()),
  );
}

export async function createProject(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const rawsDir = join(shashokuDir, DIR_RAWS);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const fontsDir = join(shashokuDir, DIR_FONTS);

  await mkdir(rawsDir, { recursive: true });
  await mkdir(pagesRoot, { recursive: true });
  await mkdir(fontsDir, { recursive: true });

  
  await writeFileAtomic(join(shashokuDir, SENTINEL_FILENAME), "shashoku\n");
  await writeFileAtomic(
    join(shashokuDir, PROJECT_JSON_FILENAME),
    serializeProjectJson(defaultProjectJson()),
  );

  
  
  
  const rootImages = await listImages(rootPath);
  assertNoStemCollision(rootImages);
  for (const filename of rootImages) {
    await initPageEntry(rootPath, shashokuDir, filename);
  }

  return await buildOpenResult(rootPath);
}


export async function importPages(
  rootPath: string,
  filenames: string[],
): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const rawsFiles = await listImages(join(shashokuDir, DIR_RAWS));
  const rawsExisting = new Set(rawsFiles);
  const existingStems = new Set(rawsFiles.map(stemOf));
  const seenStems = new Set<string>();
  for (const filename of filenames) {
    if (rawsExisting.has(filename)) continue;
    const stem = stemOf(filename);
    if (existingStems.has(stem)) continue;
    if (seenStems.has(stem)) continue;
    seenStems.add(stem);
    await initPageEntry(rootPath, shashokuDir, filename);
  }
  return await buildOpenResult(rootPath);
}


function assertNoStemCollision(filenames: string[]): void {
  const stemToFiles = new Map<string, string[]>();
  for (const f of filenames) {
    const s = stemOf(f);
    const list = stemToFiles.get(s) ?? [];
    list.push(f);
    stemToFiles.set(s, list);
  }
  const collisions: string[] = [];
  for (const [stem, files] of stemToFiles) {
    if (files.length > 1) collisions.push(`${stem}(${files.join(", ")})`);
  }
  if (collisions.length > 0) {
    throw new Error(
      `原圖檔名 stem 衝突,請保留單一副檔名:${collisions.join("; ")}`,
    );
  }
}

export async function openProject(rootPath: string): Promise<OpenProjectResult> {
  
  
  
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const pageDirs = await listPageDirs(pagesRoot);
  for (const stem of pageDirs) {
    await gcOrphanLayers(join(pagesRoot, stem));
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
 * without recursing, so a finished page written beside the raws would be
 * offered back as a new page to import on the next rescan — and importing it
 * would typeset the text a second time onto text already burnt in. Any
 * subfolder is safe, which is why every profile has one.
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
