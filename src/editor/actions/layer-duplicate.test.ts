import { describe, expect, it } from "vitest";
import { layerNames, makeCtx } from "../test-utils";
import { duplicateLayer } from "./layer-duplicate";

describe("duplicateLayer", () => {
  it("拷貝 buffer 與屬性,插在來源正上方;undo/redo 正確", () => {
    const { ctx, doc, history } = makeCtx(["底圖", "筆刷"]);
    const src = doc.layers[0];
    src.data[0] = 200; // 標記像素
    src.opacity = 0.5;
    src.blendMode = "multiply";
    src.alphaLocked = true;

    const copy = duplicateLayer(ctx, src.id)!;
    expect(layerNames(doc)).toEqual(["底圖", "底圖 拷貝", "筆刷"]);
    expect(copy.data[0]).toBe(200);
    expect(copy.opacity).toBe(0.5);
    expect(copy.blendMode).toBe("multiply");
    expect(copy.alphaLocked).toBe(true);
    expect(copy.data).not.toBe(src.data); // 深拷貝,不共享 buffer

    copy.data[0] = 7;
    expect(src.data[0]).toBe(200);

    history.undo();
    expect(layerNames(doc)).toEqual(["底圖", "筆刷"]);
    history.redo();
    expect(doc.layers[1]).toBe(copy);
  });

  it("不存在的 id 回 null", () => {
    const { ctx } = makeCtx();
    expect(duplicateLayer(ctx, "nope")).toBeNull();
  });
});
