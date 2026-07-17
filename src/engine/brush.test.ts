import { describe, expect, it } from "vitest";
import { stampBrush } from "./brush";
import { createRasterLayer } from "./layer";

const RED = { r: 255, g: 0, b: 0 };

describe("stampBrush + alphaLock(純 buffer,無 canvas)", () => {
  it("一般 paint 會建立 alpha;alphaLock paint 不改 alpha、透明處不落筆", () => {
    const w = 16;
    const h = 16;
    const layer = createRasterLayer("t", w, h);
    // 左半先鋪不透明白色
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * w + x) * 4;
        layer.data[i] = 255;
        layer.data[i + 1] = 255;
        layer.data[i + 2] = 255;
        layer.data[i + 3] = 255;
      }
    }

    // alphaLock:硬邊大筆刷蓋整張
    stampBrush(layer, w, h, 8, 8, 12, 1, RED, "paint", true);

    const left = (8 * w + 4) * 4; // 左半:已有像素 → 被染紅,alpha 不變
    expect(layer.data[left]).toBe(255);
    expect(layer.data[left + 1]).toBe(0);
    expect(layer.data[left + 3]).toBe(255);

    const right = (8 * w + 12) * 4; // 右半:原本全透明 → 完全不落筆
    expect(layer.data[right + 3]).toBe(0);
    expect(layer.data[right]).toBe(0);
  });

  it("alphaLock 下 erase 無效(dirty rect 為空)", () => {
    const w = 8;
    const h = 8;
    const layer = createRasterLayer("t", w, h);
    layer.data.fill(255);

    const r = stampBrush(layer, w, h, 4, 4, 6, 1, RED, "erase", true);
    expect(r.w).toBe(0);
    expect(layer.data[3]).toBe(255); // alpha 原封不動
  });

  it("一般 erase 依戳印強度削 alpha", () => {
    const w = 8;
    const h = 8;
    const layer = createRasterLayer("t", w, h);
    layer.data.fill(255);
    stampBrush(layer, w, h, 4, 4, 6, 1, RED, "erase");
    expect(layer.data[(4 * w + 4) * 4 + 3]).toBe(0); // 圓心整個擦掉
  });

  it("selection 約束:選區外不落筆,soft 邊按強度落", () => {
    const w = 8;
    const h = 8;
    const layer = createRasterLayer("t", w, h);
    const sel = new Uint8ClampedArray(w * h);
    sel[4 * w + 4] = 255; // 只選 (4,4)
    sel[4 * w + 5] = 128; // (5,4) 半選

    stampBrush(layer, w, h, 4, 4, 6, 1, RED, "paint", false, sel);
    expect(layer.data[(4 * w + 4) * 4 + 3]).toBe(255); // 全選處全強度
    expect(layer.data[(4 * w + 5) * 4 + 3]).toBe(128); // 半選處半強度
    expect(layer.data[(4 * w + 3) * 4 + 3]).toBe(0); // 選區外不落筆
  });
});
