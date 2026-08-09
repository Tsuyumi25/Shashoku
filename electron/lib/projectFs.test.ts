import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPathSegment, createPage, createProject, deletePage, openProject } from "./projectFs";
import { parseManifest } from "@shared/page/schema";
import { parseProjectJson, serializeProjectJson } from "@shared/project/schema";
import {
  DIR_LAYERS,
  DIR_PAGES,
  PAGE_MANIFEST_FILENAME,
  PROJECT_JSON_FILENAME,
  SHASHOKU_DIR,
} from "@shared/ssk/constants";

describe("assertPathSegment", () => {
  it("lets an ordinary name through", () => {
    expect(() => assertPathSegment("001.png", "檔名")).not.toThrow();
    expect(() => assertPathSegment("jpg-color-w1280", "設定檔資料夾")).not.toThrow();
  });

  it("refuses a name that walks up", () => {
    expect(() => assertPathSegment("..", "檔名")).toThrow();
  });

  it("refuses a name carrying a separator", () => {
    expect(() => assertPathSegment("../../etc/passwd", "檔名")).toThrow();
    expect(() => assertPathSegment("a/b.png", "檔名")).toThrow();
    expect(() => assertPathSegment("a\\b.png", "檔名")).toThrow();
  });

  it("refuses the current folder", () => {
    expect(() => assertPathSegment(".", "設定檔資料夾")).toThrow();
  });

  it("refuses an empty name", () => {
    expect(() => assertPathSegment("", "檔名")).toThrow();
  });

  it("names what it refused, so the message can be shown", () => {
    expect(() => assertPathSegment("a/b", "檔名")).toThrow(/檔名/);
  });
});

/**
 * Making a page reaches the native engine, which is a separate build step. Skip
 * rather than fail when it is not there: a fresh clone runs the tests before it
 * runs `pnpm engine:build`, and everything above this line has no addon in it.
 */
const haveEngine = (() => {
  try {
    createRequire(import.meta.url).resolve("@shashoku/engine");
    return true;
  } catch {
    return false;
  }
})();

/** A tiny PNG whose pixels are known, so what lands in `layers/` can be checked. */
function sourcePng(width: number, height: number): Buffer {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) raw.push(x * 40, y * 60, (x ^ y) * 30, 255);
  }
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe.skipIf(!haveEngine)("a page made from a source image", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shashoku-project-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function manifestOf(pageDir: string) {
    return parseManifest(await readFile(join(pageDir, PAGE_MANIFEST_FILENAME), "utf8"));
  }

  /**
   * Reading a source is irreversible and takes real time, so opening a folder
   * does not do it. It waits to be asked.
   */
  it("is not made by opening the folder it came from", async () => {
    await writeFile(join(root, "001.png"), sourcePng(6, 4));

    const opened = await createProject(root);

    expect(opened.pages).toEqual([]);
  });

  it("is named after the image and the moment it was made", async () => {
    await writeFile(join(root, "001.png"), sourcePng(6, 4));
    await createProject(root);

    expect(await createPage(root, "001.png")).toMatch(/^001-\d{6}-\d{4}$/);
    expect((await openProject(root)).pages.map((p) => p.badge)).toEqual(["ok"]);
  });

  it("leaves the source behind entirely", async () => {
    await writeFile(join(root, "001.png"), sourcePng(6, 4));
    await createProject(root);
    await createPage(root, "001.png");
    await rm(join(root, "001.png"));

    const reopened = await openProject(root);

    expect(reopened.pages.map((p) => p.badge)).toEqual(["ok"]);
    expect((await manifestOf(reopened.pages[0].pageDir)).layers).toHaveLength(1);
  });

  /**
   * The page's grid is written when it is made, not discovered later: there is
   * no image behind the page to measure once the base map is a layer that can
   * be hidden, moved or deleted.
   */
  it("takes its size and its name from the image it was made from", async () => {
    await writeFile(join(root, "第01話.png"), sourcePng(7, 3));
    await createProject(root);
    await createPage(root, "第01話.png");

    const opened = await openProject(root);
    const manifest = await manifestOf(opened.pages[0].pageDir);

    expect([manifest.width, manifest.height]).toEqual([7, 3]);
    expect(manifest.name).toBe("第01話.png");
  });

  it("starts with the base map as a locked raster covering the page", async () => {
    await writeFile(join(root, "001.png"), sourcePng(6, 4));
    await createProject(root);
    await createPage(root, "001.png");

    const opened = await openProject(root);
    const [base] = (await manifestOf(opened.pages[0].pageDir)).layers;

    expect(base.kind).toBe("raster");
    if (base.kind !== "raster") return;
    expect(base.locked).toBe(true);
    expect([base.x, base.y, base.w, base.h]).toEqual([0, 0, 6, 4]);
    const written = await readFile(
      join(opened.pages[0].pageDir, DIR_LAYERS, base.file),
    );
    expect(written.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("does not read a format the engine has no decoder for", async () => {
    await writeFile(join(root, "001.png"), Buffer.from("II*\0 not a png at all"));
    await createProject(root);

    await expect(createPage(root, "001.png")).rejects.toThrow();
    // Nothing half-made is left where the next open would adopt it as a page.
    await expect(openProject(root)).resolves.toMatchObject({ pages: [] });
  });
});

describe.skipIf(!haveEngine)("the page list and the directories", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shashoku-order-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function pagesRoot(): string {
    return join(root, SHASHOKU_DIR, DIR_PAGES);
  }

  async function writeList(pages: string[]): Promise<void> {
    const path = join(root, SHASHOKU_DIR, PROJECT_JSON_FILENAME);
    const project = parseProjectJson(await readFile(path, "utf8"));
    await writeFile(path, serializeProjectJson({ ...project, pages }));
  }

  async function threePages(): Promise<string[]> {
    const names = ["001.png", "002.png", "003.png"];
    for (const name of names) await writeFile(join(root, name), sourcePng(4, 4));
    await createProject(root);
    for (const name of names) await createPage(root, name);
    return (await openProject(root)).pages.map((p) => p.pageId);
  }

  it("reads pages in the order the list gives, not the order the disk does", async () => {
    const [a, b, c] = await threePages();
    await writeList([c, a, b]);

    const opened = await openProject(root);

    expect(opened.pages.map((p) => p.pageId)).toEqual([c, a, b]);
  });

  /**
   * A crash between making a directory and saving the document lands here, and
   * so does a user moving one in by hand. Either way it is a page.
   */
  it("takes in a directory the list never mentioned, at the end", async () => {
    const [a, b, c] = await threePages();
    await writeList([c, a]);

    const opened = await openProject(root);

    expect(opened.pages.map((p) => p.pageId)).toEqual([c, a, b]);
    expect(opened.pages.map((p) => p.badge)).toEqual(["ok", "ok", "ok"]);
  });

  it("keeps a listed page whose directory is gone, and marks it", async () => {
    const [a, b, c] = await threePages();
    await writeList([a, b, c]);
    await rm(join(pagesRoot(), b), { recursive: true });

    const opened = await openProject(root);
    const gone = opened.pages.find((p) => p.pageId === b);

    expect(gone?.badge).toBe("missing");
    expect(opened.pages[0].pageId).toBe(a);
  });

  it("marks a page whose manifest will not parse", async () => {
    const [a] = await threePages();
    await writeFile(join(pagesRoot(), a, PAGE_MANIFEST_FILENAME), "{ not json");

    const opened = await openProject(root);

    expect(opened.pages.find((p) => p.pageId === a)?.badge).toBe("damaged");
  });

  it("appends later pages after the ones already there", async () => {
    const made = await threePages();
    await writeList(made);
    await writeFile(join(root, "004.png"), sourcePng(4, 4));
    await createPage(root, "004.png");

    const opened = await openProject(root);

    expect(opened.pages).toHaveLength(4);
    expect(opened.pages[3].pageId).toMatch(/^004-/);
  });

  /**
   * Two pages from the same source name, made in the same minute, would want
   * the same directory. The second is counted past rather than overwriting the
   * first — which is the whole of what makes creating a page repeatable.
   */
  it("counts past a name a page already answers to", async () => {
    await writeFile(join(root, "001.png"), sourcePng(4, 4));
    await createProject(root);
    const first = await createPage(root, "001.png");
    const second = await createPage(root, "001.png");

    expect(second).toBe(`${first}-2`);
    expect((await openProject(root)).pages).toHaveLength(2);
  });

  it("has no pages in a folder of no images", async () => {
    await mkdir(join(root, "somewhere-else"), { recursive: true });
    const opened = await createProject(root);
    expect(opened.pages).toEqual([]);
  });
});

describe.skipIf(!haveEngine)("taking a page away", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shashoku-delete-"));
    await writeFile(join(root, "001.png"), sourcePng(4, 4));
    await writeFile(join(root, "002.png"), sourcePng(4, 4));
    await createProject(root);
    await createPage(root, "001.png");
    await createPage(root, "002.png");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("removes the directory, so the page is gone at the next open", async () => {
    const [first] = (await openProject(root)).pages;

    await deletePage(root, first.pageId);

    const opened = await openProject(root);
    expect(opened.pages.map((p) => p.pageId)).not.toContain(first.pageId);
    expect(opened.pages).toHaveLength(1);
  });

  /**
   * The list can outlive the directory — a sync that only got halfway, a disk
   * cleared by hand. Clearing that entry has to be possible, so being asked to
   * delete something already gone is a success rather than a fault.
   */
  it("succeeds on a page whose directory is already gone", async () => {
    const [first] = (await openProject(root)).pages;
    await rm(join(root, SHASHOKU_DIR, DIR_PAGES, first.pageId), { recursive: true });

    await expect(deletePage(root, first.pageId)).resolves.toBeUndefined();
  });

  it("refuses a name that is not one directory", async () => {
    await expect(deletePage(root, "../..")).rejects.toThrow();
    await expect(deletePage(root, "a/b")).rejects.toThrow();
  });

  it("leaves the other pages alone", async () => {
    const [first, second] = (await openProject(root)).pages;
    await deletePage(root, first.pageId);

    const opened = await openProject(root);
    expect(opened.pages.map((p) => p.pageId)).toEqual([second.pageId]);
    expect(opened.pages[0].badge).toBe("ok");
  });
});
