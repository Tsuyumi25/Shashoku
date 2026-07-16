import { describe, expect, it } from "vitest";
import { copyRect, writeRect } from "./pixelPatch";

describe("copyRect / writeRect(筆劃 undo 原語)", () => {
  it("round-trip:抄出→改壞→寫回 = 原樣;rect 外不受影響", () => {
    const docW = 4;
    const docH = 4;
    const buf = new Uint8ClampedArray(docW * docH * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 251; // 可辨識的填充

    const r = { x: 1, y: 1, w: 2, h: 2 };
    const before = copyRect(buf, docW, r);
    expect(before).toHaveLength(2 * 2 * 4);
    // 抄出的第一個像素 = buf 的 (1,1)
    expect(before[0]).toBe(buf[(1 * docW + 1) * 4]);

    const outside = buf[(0 * docW + 3) * 4]; // rect 外樣本
    // 蹂躪 rect 區域
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) buf.fill(0, (y * docW + x) * 4, (y * docW + x) * 4 + 4);

    writeRect(buf, docW, r, before);
    for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(i % 251);
    expect(buf[(0 * docW + 3) * 4]).toBe(outside);
  });
});
