// 匯入字體 v2:app 私有 fontconfig。把匯入資料夾寫進自訂 fonts.conf,
// FONTCONFIG_FILE 指過去——字體走平台路徑(freetype),不是 web font:
//
// - 不過 OTS(OpenType Sanitizer):FontFace 路線對舊字體(2004 年代
//   王漢宗、轉製 CJK 字體)大量拒收(94 個 decode failed),平台路徑全吃
// - queryLocalFonts 直接枚舉到,含 postscriptName;ttc 集合檔全部 face 可用
// - 渲染走系統字體快路,不是逐字體 fetch+sanitize
// - 系統 fontconfig 零污染:自訂 conf 只活在本 app 進程的 env 裡
//
// 代價:fontconfig 在 Chromium 初始化時讀一次,改資料夾要重啟 app 生效。
// Linux-only(macOS/Windows 的平台字體註冊是另一套,到時再接)。
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function foldersFile(): string {
  return join(app.getPath("userData"), "font-folders.json");
}

export function loadFontFolders(): string[] {
  try {
    const v: unknown = JSON.parse(readFileSync(foldersFile(), "utf8"));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 持久化資料夾清單並重寫 fonts.conf(供下次啟動;本次進程不受影響) */
export function saveFontFolders(folders: string[]): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(foldersFile(), `${JSON.stringify(folders, null, 2)}\n`);
  writeFontsConf(folders);
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeFontsConf(folders: string[]): string {
  const userData = app.getPath("userData");
  const cacheDir = join(userData, "fontconfig-cache");
  mkdirSync(cacheDir, { recursive: true });
  const dirs = folders.map((f) => `  <dir>${escapeXml(f)}</dir>`).join("\n");
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<!-- Shashoku 自動生成:系統配置 + 匯入字體資料夾。手改無效,由 app 覆寫。 -->
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
${dirs}
  <cachedir>${escapeXml(cacheDir)}</cachedir>
</fontconfig>
`;
  const confPath = join(userData, "fonts.conf");
  writeFileSync(confPath, conf);
  return confPath;
}

/** 必須在 Chromium 初始化字體棧前呼叫(main module 頂層,app ready 之前)。
 * 已實測:main 頂層設 process.env 來得及,queryLocalFonts 看得到全部匯入字體。 */
export function applyFontconfig(): void {
  if (process.platform !== "linux") return;
  const folders = loadFontFolders();
  if (!folders.length) return;
  process.env.FONTCONFIG_FILE = writeFontsConf(folders);
}
