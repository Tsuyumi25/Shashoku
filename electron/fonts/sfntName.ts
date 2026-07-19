// 從字體檔讀 name table 的最小解析器:只認 sfnt(ttf/otf)與 ttc 集合,
// 只讀 header/table directory/name table 三段(fd 定點讀,不整檔載入——
// CJK 字體動輒 10MB+,掃整個資料夾不該搬那麼多位元組)。
// woff/woff2(表被壓縮)與 .fon(古董點陣)不支援,回傳空陣列。
import { open, type FileHandle } from "node:fs/promises";
import type { FontFaceName } from "../../shared/ipc";

const TAG_TTCF = 0x74746366; // 'ttcf'
const TAG_OTTO = 0x4f54544f; // 'OTTO'(CFF)
const TAG_TRUE = 0x74727565; // 'true'(舊 Mac TrueType)
const TAG_SFNT = 0x00010000;
const TAG_NAME = 0x6e616d65; // 'name'

// 顯示名的語言優先序:繁中 → 港繁 → 日 → 英(Windows platform langID)
const LANG_PRIORITY = [0x0404, 0x0c04, 0x0411, 0x0409];

/** 解析一個字體檔的名稱。ttc 回傳集合內全部 face(順序即檔內順序)。 */
export async function readFontNames(path: string): Promise<FontFaceName[]> {
  const fd = await open(path, "r");
  try {
    const head = Buffer.alloc(12);
    await fd.read(head, 0, 12, 0);
    const tag = head.readUInt32BE(0);
    if (tag === TAG_TTCF) {
      const numFonts = head.readUInt32BE(8);
      if (numFonts > 64) return [];
      const offs = Buffer.alloc(4 * numFonts);
      await fd.read(offs, 0, offs.length, 12);
      const faces: FontFaceName[] = [];
      for (let i = 0; i < numFonts; i++) {
        const face = await readSfntNames(fd, offs.readUInt32BE(i * 4));
        if (face) faces.push(face);
      }
      return faces;
    }
    if (tag === TAG_SFNT || tag === TAG_OTTO || tag === TAG_TRUE) {
      const face = await readSfntNames(fd, 0);
      return face ? [face] : [];
    }
    return [];
  } finally {
    await fd.close();
  }
}

async function readSfntNames(fd: FileHandle, base: number): Promise<FontFaceName | null> {
  const hdr = Buffer.alloc(12);
  await fd.read(hdr, 0, 12, base);
  const numTables = hdr.readUInt16BE(4);
  if (numTables === 0 || numTables > 512) return null;
  const dir = Buffer.alloc(numTables * 16);
  await fd.read(dir, 0, dir.length, base + 12);
  for (let i = 0; i < numTables; i++) {
    const rec = i * 16;
    if (dir.readUInt32BE(rec) !== TAG_NAME) continue;
    // table offset 一律從檔案起點算(ttc 內的 face 共用表也一樣)
    const off = dir.readUInt32BE(rec + 8);
    const len = dir.readUInt32BE(rec + 12);
    if (len < 6 || len > 1 << 20) return null;
    const table = Buffer.alloc(len);
    await fd.read(table, 0, len, off);
    return parseNameTable(table);
  }
  return null;
}

function parseNameTable(t: Buffer): FontFaceName | null {
  const count = t.readUInt16BE(2);
  const strOff = t.readUInt16BE(4);
  const byId = new Map<number, { plat: number; lang: number; text: string }[]>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > t.length) break;
    const plat = t.readUInt16BE(r);
    const enc = t.readUInt16BE(r + 2);
    const lang = t.readUInt16BE(r + 4);
    const nameID = t.readUInt16BE(r + 6);
    const len = t.readUInt16BE(r + 8);
    const off = t.readUInt16BE(r + 10);
    // 1=family, 4=full, 6=postscript, 16=typographic family(有則優先於 1)
    if (nameID !== 1 && nameID !== 4 && nameID !== 6 && nameID !== 16) continue;
    const s = strOff + off;
    if (s + len > t.length) continue;
    const raw = t.subarray(s, s + len);
    let text: string;
    if (plat === 3 || plat === 0) text = decodeUtf16Be(raw);
    else if (plat === 1 && enc === 0) text = raw.toString("latin1");
    else continue;
    text = text.replace(/\0/g, "").trim();
    if (!text) continue;
    let list = byId.get(nameID);
    if (!list) byId.set(nameID, (list = []));
    list.push({ plat, lang, text });
  }
  const pick = (id: number): string => {
    const c = byId.get(id);
    if (!c?.length) return "";
    for (const lang of LANG_PRIORITY) {
      const hit = c.find((x) => x.plat === 3 && x.lang === lang);
      if (hit) return hit.text;
    }
    return (c.find((x) => x.plat === 3) ?? c[0]).text;
  };
  const family = pick(16) || pick(1);
  if (!family) return null;
  return { family, fullName: pick(4) || family, postscriptName: pick(6) };
}

function decodeUtf16Be(b: Buffer): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
  return s;
}
