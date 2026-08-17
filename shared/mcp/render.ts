import type { PageTexts } from "./types";

/**
 * The wire answer is a script for a model to read, not JSON: ids stay next to
 * the text they name, and an empty answer is said out loud — a blank line
 * would read as "nothing here" when it means "not translated yet".
 */
export function renderTexts(pages: PageTexts[]): string {
  const total = pages.reduce((n, p) => n + p.objects.length, 0);
  const out: string[] = [`專案 · ${pages.length} 頁 · ${total} 個文字物件`];
  for (const page of pages) {
    out.push("");
    if (page.badge !== "ok") {
      out.push(`頁 ${page.pageId} ·（${page.badge}，內容不可讀）`);
      continue;
    }
    out.push(`頁 ${page.pageId} · ${page.objects.length} 個文字物件`);
    for (const obj of page.objects) {
      out.push(obj.id);
      out.push(`  原文: ${obj.source ?? "（無）"}`);
      out.push(`  譯文: ${obj.translation === "" ? "（未翻）" : obj.translation}`);
    }
  }
  return out.join("\n");
}
