import type { RasterLayer, Rect } from "./types";

// 選區 = 整頁 8-bit soft mask(Uint8ClampedArray,w*h,255 = 全選中)。
// null(呼叫端語意)= 無選區 = 不約束。soft 值讓羽化/抗鋸齒邊有意義;
// 工具約束一律用「強度乘上 mask/255」,不是布林裁切。

/** 全 0 → null 語意由呼叫端處理;這裡回傳選中像素的包圍盒,全空回 null。 */
export function boundsOfMask(mask: Uint8ClampedArray, w: number, h: number): Rect | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 矩形選區(rect 需已 clamp 進邊界)。 */
export function rectMask(w: number, h: number, r: Rect): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  for (let y = r.y; y < r.y + r.h; y++) {
    mask.fill(255, y * w + r.x, y * w + r.x + r.w);
  }
  return mask;
}

/** 全選。 */
export function fullMask(w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  mask.fill(255);
  return mask;
}

/** 反轉(soft 值一併反轉)。回傳新 mask。 */
export function invertMask(mask: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 255 - mask[i];
  return out;
}

/**
 * 清除選區內容(PS 的 Delete):選中處 alpha 依 mask 強度削掉。
 * 回傳實際影響的 bounds(呼叫端拿去記 pixel-history 與 dirty sync)。
 */
export function clearSelected(
  layer: RasterLayer,
  w: number,
  mask: Uint8ClampedArray,
  bounds: Rect,
): Rect {
  const data = layer.data;
  const x1 = bounds.x + bounds.w;
  const y1 = bounds.y + bounds.h;
  for (let y = bounds.y; y < y1; y++) {
    for (let x = bounds.x; x < x1; x++) {
      const m = mask[y * w + x];
      if (m === 0) continue;
      const idx = (y * w + x) * 4 + 3;
      data[idx] = data[idx] * (1 - m / 255);
    }
  }
  return bounds;
}
