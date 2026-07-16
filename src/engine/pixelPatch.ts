import type { Rect } from "./types";

// 筆劃級 undo 的原語:把 doc 尺寸 buffer 的矩形區域抄出/寫回。
// 筆劃 undo = {rect, before, after} 三元組——不存整層(一層十幾 MB),
// 只存筆劃包圍盒兩份,由 History 上限自然回收。

/** 從 doc 尺寸的 RGBA buffer 抄出 rect 區域(rect 需已 clamp 進邊界)。 */
export function copyRect(src: Uint8ClampedArray, docW: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const srcStart = ((r.y + y) * docW + r.x) * 4;
    out.set(src.subarray(srcStart, srcStart + r.w * 4), y * r.w * 4);
  }
  return out;
}

/** 把 copyRect 抄出的區域寫回 doc 尺寸 buffer 的同一 rect。 */
export function writeRect(
  dst: Uint8ClampedArray,
  docW: number,
  r: Rect,
  patch: Uint8ClampedArray,
): void {
  for (let y = 0; y < r.h; y++) {
    const dstStart = ((r.y + y) * docW + r.x) * 4;
    dst.set(patch.subarray(y * r.w * 4, (y + 1) * r.w * 4), dstStart);
  }
}
