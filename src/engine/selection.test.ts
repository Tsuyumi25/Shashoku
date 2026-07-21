import { describe, expect, it } from "vitest";
import { createRasterLayer } from "./layer";
import { boundsOfMask, clearSelected, fullMask, invertMask, rectMask } from "./selection";

describe("selection(soft mask 原語)", () => {
  it("rectMask + boundsOfMask round-trip", () => {
    const mask = rectMask(8, 8, { x: 2, y: 3, w: 3, h: 2 });
    expect(mask[3 * 8 + 2]).toBe(255);
    expect(mask[3 * 8 + 5]).toBe(0); // rect 右界外
    expect(boundsOfMask(mask, 8, 8)).toEqual({ x: 2, y: 3, w: 3, h: 2 });
    expect(boundsOfMask(new Uint8ClampedArray(64), 8, 8)).toBeNull();
  });

  it("invertMask:soft 值一併反轉;全選反轉 = 全空", () => {
    const mask = fullMask(4, 4);
    mask[0] = 100;
    const inv = invertMask(mask);
    expect(inv[0]).toBe(155);
    expect(inv[1]).toBe(0);
    expect(boundsOfMask(invertMask(fullMask(4, 4)), 4, 4)).toBeNull();
  });

  it("clearSelected:選中處 alpha 依強度削,選外不動", () => {
    const layer = createRasterLayer("t", 4, 4);
    layer.data.fill(255);
    const mask = new Uint8ClampedArray(16);
    mask[5] = 255; // (1,1) 全選
    mask[6] = 128; // (2,1) 半選

    clearSelected(layer, 4, mask, { x: 1, y: 1, w: 2, h: 1 });
    expect(layer.data[5 * 4 + 3]).toBe(0); // 全清
    expect(layer.data[6 * 4 + 3]).toBe(127); // 半清(255 * (1-128/255))
    expect(layer.data[0 * 4 + 3]).toBe(255); // 選外原封不動
  });
});
