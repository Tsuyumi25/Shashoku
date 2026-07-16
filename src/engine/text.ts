import type { TextObject } from "./types";

const LINE_HEIGHT_RATIO = 1.2;

interface TextRun {
  text: string;
  x: number;
  y: number;
}

/**
 * POC 排版規則(沿用 LabelPlus 世代的預覽邏輯):錨點是整個文字區塊中心;
 * 水平文字逐行向下;直排逐字向下、手動換行產生由右往左的新欄。
 * PS 級的基線、標點旋轉、實際 leading 是之後的事。
 */
export function layoutText(t: TextObject): TextRun[] {
  if (t.text === "") return [];
  const lines = t.text.replace(/\r\n?/g, "\n").split("\n");
  const lh = t.fontSizePx * LINE_HEIGHT_RATIO;

  if (t.direction === "horizontal") {
    const runs: TextRun[] = [];
    lines.forEach((line, i) => {
      if (line === "") return;
      runs.push({ text: line, x: t.x, y: t.y + (i - (lines.length - 1) / 2) * lh });
    });
    return runs;
  }

  const runs: TextRun[] = [];
  for (let col = 0; col < lines.length; col++) {
    const glyphs = Array.from(lines[col]);
    for (let row = 0; row < glyphs.length; row++) {
      runs.push({
        text: glyphs[row],
        x: t.x + ((lines.length - 1) / 2 - col) * lh,
        y: t.y + (row - (glyphs.length - 1) / 2) * lh,
      });
    }
  }
  return runs;
}

/** 把一組文字物件畫到 doc space 的 2D context(顯示疊層、匯出壓平共用)。 */
export function renderTexts(ctx: CanvasRenderingContext2D, texts: TextObject[]): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of texts) {
    ctx.font = `${t.fontSizePx}px ${cssFamily(t.fontFamily)}`;
    ctx.fillStyle = t.color;
    for (const run of layoutText(t)) {
      ctx.fillText(run.text, run.x, run.y);
    }
  }
  ctx.restore();
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
function cssFamily(family: string): string {
  const f = family.trim() || "sans-serif";
  return GENERIC.has(f.toLowerCase()) ? f : JSON.stringify(f);
}
