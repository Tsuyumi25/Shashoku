import type { RasterLayer, Rect } from "./types";
import { clampRect } from "./geom";

export interface ScreentoneParams {
  pitch: number; // 網點格距(px)
  angle: number; // 網屏角度(度),漫畫常用 45°
  density: number; // 覆蓋率 0..1,越大點越大 = 越暗
  color: { r: number; g: number; b: number };
}

/**
 * 在 layer 的 rect 範圍內「填」上振幅調變網點(AM screentone):
 * 點在一個被旋轉的方格上,點半徑隨密度變大。這是 PS 沒有、卻是漫畫嵌字
 * 天天要用的東西 —— POC 要證明它在自足軟體裡做得出來、且是「工具」而非濾鏡。
 *
 * 語意是「填」(覆寫該 rect),不是疊加,所以重複拖同一塊不會越描越黑。
 * selection(soft mask,null = 不約束):選區外像素保持原樣,羽化邊按強度縮 alpha。
 */
export function fillScreentoneRect(
  layer: RasterLayer,
  w: number,
  h: number,
  rect: Rect,
  p: ScreentoneParams,
  selection: Uint8ClampedArray | null = null,
): Rect {
  const r = clampRect(rect, w, h);
  if (r.w === 0 || r.h === 0) return r;

  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pitch = Math.max(2, p.pitch);
  const d = Math.min(1, Math.max(0, p.density));
  // 覆蓋率 d = 點面積 / 格面積 → r = pitch*sqrt(d/π);夾住避免點糊成一片。
  const dotR = Math.min(pitch * 0.71, pitch * Math.sqrt(d / Math.PI));
  const data = layer.data;

  for (let py = r.y; py < r.y + r.h; py++) {
    for (let px = r.x; px < r.x + r.w; px++) {
      let strength = 1;
      if (selection) {
        const m = selection[py * w + px];
        if (m === 0) continue; // 選區外:保持原樣,不覆寫
        strength = m / 255;
      }
      // 旋進網屏座標,找最近的格中心。
      const u = px * cos + py * sin;
      const v = -px * sin + py * cos;
      const cu = Math.round(u / pitch) * pitch;
      const cv = Math.round(v / pitch) * pitch;
      const dist = Math.hypot(u - cu, v - cv);
      // 邊緣 ±0.5px 抗鋸齒。
      const a = clamp01((dotR + 0.5 - dist) / 1) * strength;

      const idx = (py * w + px) * 4;
      data[idx] = p.color.r;
      data[idx + 1] = p.color.g;
      data[idx + 2] = p.color.b;
      data[idx + 3] = a * 255; // 覆寫該 rect(選區內)
    }
  }
  return r;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
