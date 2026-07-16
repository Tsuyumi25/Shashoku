import type { Rect } from "./types";

/** 把矩形收進 [0,0,w,h] 邊界內；完全在界外時回傳零面積矩形。 */
export function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** 兩個矩形的包圍聯集（累積一整筆筆劃的 dirty 範圍用）。 */
export function unionRect(a: Rect, b: Rect): Rect {
  if (a.w === 0 || a.h === 0) return b;
  if (b.w === 0 || b.h === 0) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 以 (cx,cy) 為圓心、半徑 r 的圓，取其包圍矩形（外擴 pad px）。 */
export function circleBounds(cx: number, cy: number, r: number, pad = 1): Rect {
  const rr = r + pad;
  return { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 };
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
