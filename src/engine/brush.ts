import type { RasterLayer, Rect } from "./types";
import { circleBounds, clampRect, EMPTY_RECT } from "./geom";

export type BrushMode = "paint" | "erase";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * 在 (cx,cy) 蓋一個圓形筆刷戳印到 layer,直接改 layer.data(直通 alpha)。
 * hardness ∈ [0,1]:1 = 硬邊,越小邊緣越軟。回傳被弄髒的矩形(已 clamp),
 * 呼叫端把整筆劃的戳印 union 起來當成 dirty-rect 交給合成。
 */
export function stampBrush(
  layer: RasterLayer,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  color: RGB,
  mode: BrushMode,
): Rect {
  const bounds = clampRect(circleBounds(cx, cy, radius), w, h);
  if (bounds.w === 0 || bounds.h === 0) return EMPTY_RECT;

  const inner = radius * Math.min(0.999, hardness); // 這半徑內 alpha 滿格
  const data = layer.data;

  for (let py = bounds.y; py < bounds.y + bounds.h; py++) {
    for (let px = bounds.x; px < bounds.x + bounds.w; px++) {
      const dist = Math.hypot(px - cx, py - cy);
      if (dist > radius) continue;
      // 邊緣 falloff:inner 內為 1,radius 外為 0,中間線性。
      const sa = dist <= inner ? 1 : 1 - (dist - inner) / (radius - inner);
      if (sa <= 0) continue;

      const idx = (py * w + px) * 4;
      if (mode === "erase") {
        // dst-out:把該像素的 alpha 依戳印強度削掉。
        data[idx + 3] = data[idx + 3] * (1 - sa);
        continue;
      }
      // paint:把 color 以 sa 做 source-over 疊進去。
      const da = data[idx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA === 0) continue;
      data[idx] = (color.r * sa + data[idx] * da * (1 - sa)) / outA;
      data[idx + 1] = (color.g * sa + data[idx + 1] * da * (1 - sa)) / outA;
      data[idx + 2] = (color.b * sa + data[idx + 2] * da * (1 - sa)) / outA;
      data[idx + 3] = outA * 255;
    }
  }
  return bounds;
}
