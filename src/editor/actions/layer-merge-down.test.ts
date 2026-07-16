import { describe, expect, it } from "vitest";
import { layerNames, makeCtx } from "../test-utils";
import { mergeLayerDown } from "./layer-merge-down";

// node 環境下 canvas 是 stub,merge 的「像素結果」無法在此驗證(見 vitest.setup.ts);
// 這裡驗的是結構語意與 undo 的 buffer 還原——正是破壞性操作最要緊的那一半。
describe("mergeLayerDown", () => {
  it("移除上層;undo 還原下層 buffer 與上層物件", () => {
    const { ctx, doc, history } = makeCtx(["底圖", "筆刷", "網點"]);
    const below = doc.layers[0];
    const top = doc.layers[1];
    below.data[0] = 42; // 下層合成前的內容標記

    expect(mergeLayerDown(ctx, top.id)).toBe(true);
    expect(layerNames(doc)).toEqual(["底圖", "網點"]);

    history.undo();
    expect(layerNames(doc)).toEqual(["底圖", "筆刷", "網點"]);
    expect(doc.layers[1]).toBe(top);
    expect(below.data[0]).toBe(42); // buffer 從備份還原

    history.redo();
    expect(layerNames(doc)).toEqual(["底圖", "網點"]);
  });

  it("最底層不可向下合併", () => {
    const { ctx, doc, history } = makeCtx(["底圖", "筆刷"]);
    expect(mergeLayerDown(ctx, doc.layers[0].id)).toBe(false);
    expect(doc.layers).toHaveLength(2);
    expect(history.canUndo).toBe(false);
  });
});
