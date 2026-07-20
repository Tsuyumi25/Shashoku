// Shashoku 專案(新架構)的檔案系統操作。純 fs,不依賴 electron,方便單元測試。
// IPC binding 在 electron/ipc/shashokuProject.ts。

import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
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
  PAGE_TRANSLATION_FILENAME,
  PROJECT_JSON_FILENAME,
  SENTINEL_FILENAME,
  SHASHOKU_DIR,
} from "@shared/ssk/constants";
import { defaultProjectJson, serializeProjectJson } from "@shared/project/schema";
import {
  defaultManifest,
  defaultTranslation,
  serializeManifest,
  serializeTranslation,
} from "@shared/page/schema";
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

/** 檔名剝副檔名:001.png → 001 */
function stemOf(filename: string): string {
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
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

  // 雙邊集合對照:raws/xxx.<ext> ↔ pages/xxx/,以 stem 為 key。
  // 一邊有一邊沒的用 badge 標示(不修復、不合併)。
  const pageDirSet = new Set(pageDirs);
  const pages: PageEntry[] = [];
  const seenStems = new Set<string>();

  // 先按 raws 順序輸出「有 raw 的頁」
  for (const filename of rawFiles) {
    const stem = stemOf(filename);
    seenStems.add(stem);
    const badge: PageBadge = pageDirSet.has(stem) ? "ok" : "page-missing";
    pages.push({ filename, pageDir: join(pagesRoot, stem), badge });
  }

  // 再補「只有 page 資料夾、沒有對應 raw」的孤兒頁
  for (const stem of pageDirs) {
    if (seenStems.has(stem)) continue;
    pages.push({
      filename: stem,
      pageDir: join(pagesRoot, stem),
      badge: "raw-missing",
    });
  }

  return { projectMetaRaw, pages };
}

export async function createProject(rootPath: string): Promise<OpenProjectResult> {
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const rawsDir = join(shashokuDir, DIR_RAWS);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const fontsDir = join(shashokuDir, DIR_FONTS);

  await mkdir(rawsDir, { recursive: true });
  await mkdir(pagesRoot, { recursive: true });
  await mkdir(fontsDir, { recursive: true });

  // Sentinel marker:內容任意,存在即代表這是 Shashoku 專案根
  await writeFileAtomic(join(shashokuDir, SENTINEL_FILENAME), "shashoku\n");
  await writeFileAtomic(
    join(shashokuDir, PROJECT_JSON_FILENAME),
    serializeProjectJson(defaultProjectJson()),
  );

  const rootImages = await listImages(rootPath);
  // 無腦全複製:root/*.png → raws/*.png 同檔名;為每頁建空的 pages/<stem>/
  for (const filename of rootImages) {
    await copyFile(join(rootPath, filename), join(rawsDir, filename));
    const stem = stemOf(filename);
    const pageDir = join(pagesRoot, stem);
    await mkdir(pageDir, { recursive: true });
    // 依 manifest 最後寫慣例:先 translation.json 再 manifest.json
    await writeFileAtomic(
      join(pageDir, PAGE_TRANSLATION_FILENAME),
      serializeTranslation(defaultTranslation()),
    );
    await writeFileAtomic(
      join(pageDir, PAGE_MANIFEST_FILENAME),
      serializeManifest(defaultManifest()),
    );
  }

  return await buildOpenResult(rootPath);
}

export async function openProject(rootPath: string): Promise<OpenProjectResult> {
  return await buildOpenResult(rootPath);
}

export async function readPage(pageDir: string): Promise<PageRawData> {
  const [manifestRaw, translationRaw] = await Promise.all([
    readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8"),
    readFile(join(pageDir, PAGE_TRANSLATION_FILENAME), "utf8"),
  ]);
  const ocrPath = join(pageDir, PAGE_OCR_FILENAME);
  const ocrRaw = (await exists(ocrPath)) ? await readFile(ocrPath, "utf8") : null;
  return { manifestRaw, translationRaw, ocrRaw };
}

export async function writePage(pageDir: string, input: WritePageInput): Promise<void> {
  // 「manifest 最後寫」pattern:
  // 1. 所有 layer PNG 先落地(每張獨立 atomic)
  // 2. translation.json 落地
  // 3. ocr.json 若有的話落地
  // 4. **最後**寫 manifest.json — 這是唯一的 commit 錨點,crash 於此之前
  //    = 舊 manifest 仍指向舊完整圖層 = 頁面完整可讀,只是這次 autosave 沒生效
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

  await writeFileAtomic(join(pageDir, PAGE_TRANSLATION_FILENAME), input.translationRaw);
  if (input.ocrRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_OCR_FILENAME), input.ocrRaw);
  }
  await writeFileAtomic(join(pageDir, PAGE_MANIFEST_FILENAME), input.manifestRaw);
}

export async function writeProjectMeta(
  shashokuDir: string,
  projectMetaRaw: string,
): Promise<void> {
  await writeFileAtomic(join(shashokuDir, PROJECT_JSON_FILENAME), projectMetaRaw);
}
