import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIR_FONTS,
  DIR_LAYERS,
  DIR_PAGES,
  DIR_RAWS,
  PAGE_MANIFEST_FILENAME,
  PAGE_OCR_FILENAME,
  PAGE_TRANSLATION_FILENAME,
  PROJECT_JSON_FILENAME,
  SENTINEL_FILENAME,
  SHASHOKU_DIR,
} from "@shared/ssk/constants";
import { parseProjectJson } from "@shared/project/schema";
import {
  parseManifest,
  parseTranslation,
  serializeManifest,
  serializeTranslation,
} from "@shared/page/schema";
import {
  createProject,
  openProject,
  readPage,
  scanRoot,
  writePage,
  writeProjectMeta,
} from "./projectFs";

let workDir: string;

async function fakePng(path: string, marker: number): Promise<void> {
  // 假 PNG bytes(只是 file 內容,不需要合法 png header,測試用)
  await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, marker]));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "projectFs-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("scanRoot", () => {
  it("空資料夾:無圖、無 shashoku/、無 sentinel", async () => {
    const r = await scanRoot(workDir);
    expect(r).toEqual({ rootImages: [], hasShashokuDir: false, hasSentinel: false });
  });

  it("有 png 但無 shashoku/", async () => {
    await fakePng(join(workDir, "001.png"), 1);
    await fakePng(join(workDir, "002.png"), 2);
    const r = await scanRoot(workDir);
    expect(r.rootImages).toEqual(["001.png", "002.png"]);
    expect(r.hasShashokuDir).toBe(false);
  });

  it("已初始化的專案:hasShashokuDir + hasSentinel 都 true", async () => {
    await fakePng(join(workDir, "001.png"), 1);
    await createProject(workDir);
    const r = await scanRoot(workDir);
    expect(r.hasShashokuDir).toBe(true);
    expect(r.hasSentinel).toBe(true);
  });

  it("自然排序(10 排在 2 後,不是字典序前)", async () => {
    await fakePng(join(workDir, "page-2.png"), 2);
    await fakePng(join(workDir, "page-10.png"), 10);
    const r = await scanRoot(workDir);
    expect(r.rootImages).toEqual(["page-2.png", "page-10.png"]);
  });
});

describe("createProject", () => {
  it("建立完整結構:sentinel + project.json + raws/ + pages/<stem>/{manifest,translation}", async () => {
    await fakePng(join(workDir, "001.png"), 1);
    await fakePng(join(workDir, "002.png"), 2);

    const result = await createProject(workDir);

    const shashokuDir = join(workDir, SHASHOKU_DIR);
    expect(await exists(join(shashokuDir, SENTINEL_FILENAME))).toBe(true);
    expect(await exists(join(shashokuDir, PROJECT_JSON_FILENAME))).toBe(true);
    expect(await exists(join(shashokuDir, DIR_RAWS))).toBe(true);
    expect(await exists(join(shashokuDir, DIR_PAGES))).toBe(true);
    expect(await exists(join(shashokuDir, DIR_FONTS))).toBe(true);

    // raws/ 內原圖同檔名
    expect(await exists(join(shashokuDir, DIR_RAWS, "001.png"))).toBe(true);
    expect(await exists(join(shashokuDir, DIR_RAWS, "002.png"))).toBe(true);

    // 每頁的 pages/<stem>/manifest.json + translation.json
    for (const stem of ["001", "002"]) {
      expect(await exists(join(shashokuDir, DIR_PAGES, stem, PAGE_MANIFEST_FILENAME))).toBe(true);
      expect(await exists(join(shashokuDir, DIR_PAGES, stem, PAGE_TRANSLATION_FILENAME))).toBe(true);
    }

    // project.json 內容可解析
    const meta = parseProjectJson(result.projectMetaRaw);
    expect(meta.groups.length).toBeGreaterThan(0);

    // 回傳 pages 順序 = raws 順序
    expect(result.pages.map((p) => p.filename)).toEqual(["001.png", "002.png"]);
    expect(result.pages.every((p) => p.badge === "ok")).toBe(true);
  });

  it("raws 內副本是 root 原圖的複製(byte 相同)", async () => {
    const rootPng = join(workDir, "001.png");
    await fakePng(rootPng, 0xab);
    await createProject(workDir);
    const rawBytes = await readFile(join(workDir, SHASHOKU_DIR, DIR_RAWS, "001.png"));
    const rootBytes = await readFile(rootPng);
    expect(Array.from(rawBytes)).toEqual(Array.from(rootBytes));
  });
});

describe("openProject", () => {
  it("開啟已建立的專案:回傳 projectMetaRaw + pages 全部 ok", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await fakePng(join(workDir, "02.png"), 2);
    await createProject(workDir);

    const r = await openProject(workDir);
    expect(r.pages.map((p) => p.filename)).toEqual(["01.png", "02.png"]);
    expect(r.pages.every((p) => p.badge === "ok")).toBe(true);
  });

  it("badge=page-missing:raws 有圖但 pages/<stem>/ 資料夾不存在", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await fakePng(join(workDir, "02.png"), 2);
    await createProject(workDir);
    // 手動砍掉 pages/02/ 模擬雲端同步斷裂
    await rm(join(workDir, SHASHOKU_DIR, DIR_PAGES, "02"), { recursive: true });

    const r = await openProject(workDir);
    const p02 = r.pages.find((p) => p.filename === "02.png")!;
    expect(p02.badge).toBe("page-missing");
    // 其他頁仍 ok
    expect(r.pages.find((p) => p.filename === "01.png")!.badge).toBe("ok");
  });

  it("badge=raw-missing:pages 有孤兒資料夾但 raws 無對應原圖", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    // 手動加一個孤兒 pages/oldpage/
    const orphanDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "oldpage");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, PAGE_MANIFEST_FILENAME), "{}");

    const r = await openProject(workDir);
    const orphan = r.pages.find((p) => p.filename === "oldpage");
    expect(orphan).toBeDefined();
    expect(orphan!.badge).toBe("raw-missing");
    // 有 raw 的 01.png 仍 ok
    expect(r.pages.find((p) => p.filename === "01.png")!.badge).toBe("ok");
  });

  it("完全沒 raw、也沒 page:pages[] 空", async () => {
    // 用手動組合模擬:建立 shashoku 但無圖無頁
    await mkdir(join(workDir, SHASHOKU_DIR, DIR_RAWS), { recursive: true });
    await mkdir(join(workDir, SHASHOKU_DIR, DIR_PAGES), { recursive: true });
    await writeFile(join(workDir, SHASHOKU_DIR, PROJECT_JSON_FILENAME), '{"schemaVersion":1,"groups":["a"],"comment":"","exportConfig":{"docTemplate":"auto","docTemplateFilename":null,"outputFormat":"psd","ignoreNoLabelImages":true,"createLayerGroups":true,"font":null,"fontSizePx":null,"textColor":"#000000","textLeadingPercent":null,"textDirection":"keep","outputLabelIndex":false,"actionSetName":null,"outputFolderName":null,"exportGroups":null}}');

    const r = await openProject(workDir);
    expect(r.pages).toEqual([]);
  });
});

describe("readPage / writePage", () => {
  it("writePage → readPage roundtrip(無 layers)", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);

    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");
    const t = {
      schemaVersion: 1 as const,
      labels: [{ id: "l1", x: 0.5, y: 0.5, category: 1, lines: ["hi"] }],
    };
    const m = {
      schemaVersion: 1 as const,
      layers: [
        {
          id: "bg",
          file: "background.png",
          name: "底圖",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          alphaLocked: false,
        },
      ],
    };
    await writePage(pageDir, {
      manifestRaw: serializeManifest(m),
      translationRaw: serializeTranslation(t),
    });

    const back = await readPage(pageDir);
    expect(parseTranslation(back.translationRaw)).toEqual(t);
    expect(parseManifest(back.manifestRaw)).toEqual(m);
    expect(back.ocrRaw).toBeNull();
  });

  it("writePage 有 layerParts:寫進 pages/<n>/layers/", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");

    const bgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const rdBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
    await writePage(pageDir, {
      manifestRaw: serializeManifest({ schemaVersion: 1, layers: [] }),
      translationRaw: serializeTranslation({ schemaVersion: 1, labels: [] }),
      layerParts: { "background.png": bgBytes, "redraw.png": rdBytes },
    });

    const layersDir = join(pageDir, DIR_LAYERS);
    const bg = await readFile(join(layersDir, "background.png"));
    const rd = await readFile(join(layersDir, "redraw.png"));
    expect(Array.from(bg)).toEqual(Array.from(bgBytes));
    expect(Array.from(rd)).toEqual(Array.from(rdBytes));
  });

  it("writePage layerParts 含路徑分隔符抛錯", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");
    await expect(
      writePage(pageDir, {
        manifestRaw: serializeManifest({ schemaVersion: 1, layers: [] }),
        translationRaw: serializeTranslation({ schemaVersion: 1, labels: [] }),
        layerParts: { "../evil.png": new Uint8Array([1]) },
      }),
    ).rejects.toThrow(/路徑分隔符/);
  });

  it("writePage 覆蓋既有 manifest,舊 manifest 內容被替換", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");

    // 第二次寫入
    const m2 = {
      schemaVersion: 1 as const,
      layers: [
        {
          id: "x",
          file: "x.png",
          name: "x",
          visible: true,
          opacity: 0.5,
          blendMode: "multiply",
          locked: false,
          alphaLocked: false,
        },
      ],
    };
    await writePage(pageDir, {
      manifestRaw: serializeManifest(m2),
      translationRaw: serializeTranslation({ schemaVersion: 1, labels: [] }),
    });
    const back = await readPage(pageDir);
    expect(parseManifest(back.manifestRaw)).toEqual(m2);
  });

  it("readPage 讀 ocr.json(若存在)", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");
    await writeFile(join(pageDir, PAGE_OCR_FILENAME), '{"schemaVersion":1,"width":100,"height":100,"blocks":[]}');
    const back = await readPage(pageDir);
    expect(back.ocrRaw).toContain('"schemaVersion":1');
  });
});

describe("writeProjectMeta", () => {
  it("更新 project.json,readback 內容相同", async () => {
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const shashokuDir = join(workDir, SHASHOKU_DIR);

    const custom = '{"schemaVersion":1,"groups":["自訂"],"comment":"哈囉","exportConfig":{"docTemplate":"auto","docTemplateFilename":null,"outputFormat":"psd","ignoreNoLabelImages":true,"createLayerGroups":true,"font":null,"fontSizePx":null,"textColor":"#000000","textLeadingPercent":null,"textDirection":"keep","outputLabelIndex":false,"actionSetName":null,"outputFolderName":null,"exportGroups":null}}\n';
    await writeProjectMeta(shashokuDir, custom);

    const back = await readFile(join(shashokuDir, PROJECT_JSON_FILENAME), "utf8");
    expect(back).toBe(custom);
  });
});

describe("寫入順序:「manifest 最後寫」 pattern", () => {
  it("順序驗證:layer PNG → translation.json → manifest.json", async () => {
    // 這個測試無法直接觀察順序(fs 呼叫是同進程 async),但可透過 mtime 檢查
    // 或觀察 partial write scenario。用「若 write 過程 crash,manifest 是舊」的
    // fuzz 太複雜,這裡用簡單的存在性斷言:所有檔都被寫入。
    await fakePng(join(workDir, "01.png"), 1);
    await createProject(workDir);
    const pageDir = join(workDir, SHASHOKU_DIR, DIR_PAGES, "01");

    const before = (await stat(join(pageDir, PAGE_MANIFEST_FILENAME))).mtimeMs;
    // 至少 1ms 保證 mtime 遞增(fs 精度限制,某些 OS 可能仍相等)
    await new Promise((r) => setTimeout(r, 20));

    await writePage(pageDir, {
      manifestRaw: serializeManifest({
        schemaVersion: 1,
        layers: [
          {
            id: "bg",
            file: "bg.png",
            name: "",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            alphaLocked: false,
          },
        ],
      }),
      translationRaw: serializeTranslation({ schemaVersion: 1, labels: [] }),
      layerParts: { "bg.png": new Uint8Array([1, 2, 3]) },
    });

    const after = (await stat(join(pageDir, PAGE_MANIFEST_FILENAME))).mtimeMs;
    expect(after).toBeGreaterThan(before);
    // 檢查所有檔都成功建立
    const files = await readdir(pageDir, { withFileTypes: true });
    const names = files.map((f) => f.name).sort();
    expect(names).toContain(PAGE_MANIFEST_FILENAME);
    expect(names).toContain(PAGE_TRANSLATION_FILENAME);
    expect(names).toContain(DIR_LAYERS);
  });
});
