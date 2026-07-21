// Shashoku 專案(新架構)的檔案系統操作。純 fs,不依賴 electron,方便單元測試。
// IPC binding 在 electron/ipc/shashokuProject.ts。

import { copyFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
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
  parseManifest,
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

/** 檢查 pages/<stem>/manifest.json 存在且可 parse。損毀 → false → damaged badge。 */
async function manifestIsHealthy(pageDir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8");
    parseManifest(raw);
    return true;
  } catch {
    return false;
  }
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

  // 先按 raws 順序輸出「有 raw 的頁」;若對應 pages/<stem>/ 的 manifest 解不出來,
  // 標 damaged(避免 autosave 用新 manifest 覆蓋還可能救援的 layers)
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
    pages.push({ filename, pageDir, badge });
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

/** 把一張 root 原圖轉成新的一頁:copy 進 raws/ + mkdir pages/<stem>/ + 空 manifest/translation。
 * 若 pages/<stem>/ 已存在則拒絕(避免同 stem 不同副檔名,例如 001.png + 001.jpg,
 * 用預設值覆寫既有翻譯 + 圖層 manifest)。 */
async function initPageEntry(
  rootPath: string,
  shashokuDir: string,
  filename: string,
): Promise<void> {
  // filename 應為 basename,不含路徑分隔符。這是攻擊面守門。
  if (/[\\/]/.test(filename)) {
    throw new Error(`filename 不可含路徑分隔符:${filename}`);
  }
  const rawsDir = join(shashokuDir, DIR_RAWS);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const stem = stemOf(filename);
  const pageDir = join(pagesRoot, stem);
  // 拒絕同 stem 覆寫:pages/<stem>/ 已存在代表另一個副檔名的檔案已佔用這個頁
  if (await exists(pageDir)) {
    throw new Error(
      `頁面 stem 衝突:${filename} 對應的 pages/${stem}/ 已存在(可能有同 stem 不同副檔名的檔案,如 ${stem}.png 與 ${stem}.jpg)`,
    );
  }
  await copyFile(join(rootPath, filename), join(rawsDir, filename));
  await mkdir(pageDir, { recursive: true });
  // 依「manifest 最後寫」慣例:先 translation.json 再 manifest.json
  await writeFileAtomic(
    join(pageDir, PAGE_TRANSLATION_FILENAME),
    serializeTranslation(defaultTranslation()),
  );
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

  // Sentinel marker:內容任意,存在即代表這是 Shashoku 專案根
  await writeFileAtomic(join(shashokuDir, SENTINEL_FILENAME), "shashoku\n");
  await writeFileAtomic(
    join(shashokuDir, PROJECT_JSON_FILENAME),
    serializeProjectJson(defaultProjectJson()),
  );

  // 無腦全複製:root 內所有原圖進 raws/ + 各自 pages/<stem>/。
  // pre-check:同 stem 不同副檔名(001.png + 001.jpg)會共用 pages/001/,禁止,
  // 提前 fail 避免 partial write。
  const rootImages = await listImages(rootPath);
  assertNoStemCollision(rootImages);
  for (const filename of rootImages) {
    await initPageEntry(rootPath, shashokuDir, filename);
  }

  return await buildOpenResult(rootPath);
}

/**
 * 匯入指定的 root 原圖成為新頁(既有專案再加頁)。冪等:
 * - 已存在 raws/ 的同名檔跳過(不覆蓋既有像素)
 * - 同 stem 但不同副檔名的既有頁跳過(避免撞到 pages/<stem>/)
 * - 傳入清單內部同 stem 重複只處理第一個
 */
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

/** 掃描檔名清單,若有同 stem 不同副檔名的組合(如 001.png + 001.jpg)則拋錯。 */
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
  // openProject 是「安全時機」(沒有 pending 操作),GC 每頁 layers/ 內的
  // orphan PNG(不再被 manifest 引用的舊 revision)。crash 中不誤刪:autosave
  // 只寫新 rev,舊 rev 直到這裡才清。
  const shashokuDir = join(rootPath, SHASHOKU_DIR);
  const pagesRoot = join(shashokuDir, DIR_PAGES);
  const pageDirs = await listPageDirs(pagesRoot);
  for (const stem of pageDirs) {
    await gcOrphanLayers(join(pagesRoot, stem));
  }
  return await buildOpenResult(rootPath);
}

/**
 * 掃 pageDir/layers/*.png,刪不再被 manifest.layers[].file 引用的檔案。
 * manifest 損毀或不存在 → 不動 layers(保守),讓使用者面對錯誤 UI。
 */
async function gcOrphanLayers(pageDir: string): Promise<void> {
  const layersDir = join(pageDir, DIR_LAYERS);
  if (!(await exists(layersDir))) return;
  let referenced: Set<string>;
  try {
    const manifestRaw = await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8");
    // 遞迴收集所有 raster leaf 的檔名(nested group 也要走進去);text / group
    // 節點本身無 file,不參與 GC 判斷。
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
    // manifest 損毀或不存在:不 GC,避免誤刪救援資料
    return;
  }
  const entries = await readdir(layersDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (referenced.has(e.name)) continue;
    // orphan:不被 manifest 引用的 layer PNG,刪除
    await unlink(join(layersDir, e.name)).catch(() => {
      // 併發或已被刪:忽略
    });
  }
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
  // 2. translation.json 落地(若傳入)
  // 3. ocr.json 落地(若傳入)
  // 4. **最後**寫 manifest.json — 這是唯一的 commit 錨點,crash 於此之前
  //    = 舊 manifest 仍指向舊完整圖層 = 頁面完整可讀,只是這次 autosave 沒生效
  //
  // 各 payload 獨立:autosave 只帶 manifestRaw+layerParts 更新 raster;
  // Ctrl+S 只帶 translationRaw 更新譯文——兩條路互不覆蓋。
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

  if (input.translationRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_TRANSLATION_FILENAME), input.translationRaw);
  }
  if (input.ocrRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_OCR_FILENAME), input.ocrRaw);
  }
  if (input.manifestRaw !== undefined) {
    await writeFileAtomic(join(pageDir, PAGE_MANIFEST_FILENAME), input.manifestRaw);
  }
}

export async function writeProjectMeta(
  shashokuDir: string,
  projectMetaRaw: string,
): Promise<void> {
  await writeFileAtomic(join(shashokuDir, PROJECT_JSON_FILENAME), projectMetaRaw);
}
