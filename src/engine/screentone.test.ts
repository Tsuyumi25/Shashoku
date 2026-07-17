import { describe, expect, it } from "vitest";
import { createRasterLayer } from "./layer";
import { fillScreentoneRect } from "./screentone";

const P = { pitch: 4, angle: 0, density: 0.9, color: { r: 0, g: 0, b: 0 } };

describe("fillScreentoneRect + selection", () => {
  it("無選區:rect 內被覆寫(高密度下格中心必有點)", () => {
    const layer = createRasterLayer("t", 16, 16);
    fillScreentoneRect(layer, 16, 16, { x: 0, y: 0, w: 16, h: 16 }, P);
    // 格距 4、角度 0 → (4,4) 是格中心,density 0.9 必為實點
    expect(layer.data[(4 * 16 + 4) * 4 + 3]).toBe(255);
  });

  it("選區外像素保持原樣(不被覆寫成透明)", () => {
    const layer = createRasterLayer("t", 16, 16);
    layer.data.fill(200); // 先鋪內容
    const sel = new Uint8ClampedArray(16 * 16); // 全 0 = 全部在選區外
    sel[4 * 16 + 4] = 255; // 只選格中心那一點

    fillScreentoneRect(layer, 16, 16, { x: 0, y: 0, w: 16, h: 16 }, P, sel);
    expect(layer.data[(4 * 16 + 4) * 4 + 3]).toBe(255); // 選中處被填
    expect(layer.data[(0 * 16 + 0) * 4 + 3]).toBe(200); // 選外原封不動
    expect(layer.data[(0 * 16 + 0) * 4]).toBe(200);
  });
});
