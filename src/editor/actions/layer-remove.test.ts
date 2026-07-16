import { describe, expect, it } from "vitest";
import { layerNames, makeCtx } from "../test-utils";
import { removeLayer } from "./layer-remove";

describe("removeLayer", () => {
  it("移除指定層,undo 重插回原位(同一物件、原索引)", () => {
    const { ctx, doc, history } = makeCtx(["底圖", "去字", "筆刷"]);
    const target = doc.layers[1];
    expect(removeLayer(ctx, target.id)).toBe(true);
    expect(layerNames(doc)).toEqual(["底圖", "筆刷"]);

    history.undo();
    expect(layerNames(doc)).toEqual(["底圖", "去字", "筆刷"]);
    expect(doc.layers[1]).toBe(target);

    history.redo();
    expect(layerNames(doc)).toEqual(["底圖", "筆刷"]);
  });

  it("最後一層不可刪", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    expect(removeLayer(ctx, doc.layers[0].id)).toBe(false);
    expect(doc.layers).toHaveLength(1);
    expect(history.canUndo).toBe(false);
  });

  it("不存在的 id 回 false 且不記歷史", () => {
    const { ctx, history } = makeCtx(["底圖", "筆刷"]);
    expect(removeLayer(ctx, "nope")).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
