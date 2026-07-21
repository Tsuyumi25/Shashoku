import { describe, expect, it } from "vitest";
import { copyRect } from "@/engine/pixelPatch";
import { makeCtx, rasterAt } from "./test-utils";
import { pushPixelPatch } from "./pixel-history";

describe("pushPixelPatch(筆劃級 undo)", () => {
  it("undo 寫回 before、redo 寫回 after,rect 外不動", () => {
    const { ctx, doc, history } = makeCtx(["畫"], 4, 4);
    const layer = rasterAt(doc, 0);
    const r = { x: 1, y: 1, w: 2, h: 2 };

    const before = copyRect(layer.data, doc.width, r); // 全 0
    // 模擬筆劃:rect 內塗 200,rect 外塗一個哨兵
    for (let y = 1; y < 3; y++)
      for (let x = 1; x < 3; x++) layer.data.fill(200, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
    layer.data[0] = 99; // rect 外哨兵(0,0)

    pushPixelPatch(ctx, layer.id, r, before, "筆刷");

    history.undo();
    expect(layer.data[(1 * 4 + 1) * 4]).toBe(0); // rect 內回到 before
    expect(layer.data[0]).toBe(99); // rect 外不受 undo 影響

    history.redo();
    expect(layer.data[(1 * 4 + 1) * 4]).toBe(200);
    expect(layer.data[(2 * 4 + 2) * 4 + 3]).toBe(200);
  });

  it("零面積 rect 不記歷史", () => {
    const { ctx, doc, history } = makeCtx(["畫"], 4, 4);
    pushPixelPatch(ctx, rasterAt(doc, 0).id, { x: 0, y: 0, w: 0, h: 0 }, new Uint8ClampedArray(0), "x");
    expect(history.canUndo).toBe(false);
  });
});
