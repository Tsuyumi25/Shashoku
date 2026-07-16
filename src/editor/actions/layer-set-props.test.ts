import { describe, expect, it } from "vitest";
import { makeCtx } from "../test-utils";
import { setLayerProps } from "./layer-set-props";

describe("setLayerProps", () => {
  it("批次改屬性,undo 還原全部", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = doc.layers[0];
    setLayerProps(ctx, layer.id, { opacity: 0.4, blendMode: "multiply", locked: true });
    expect(layer.opacity).toBe(0.4);
    expect(layer.blendMode).toBe("multiply");
    expect(layer.locked).toBe(true);

    history.undo();
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");
    expect(layer.locked).toBe(false);

    history.redo();
    expect(layer.opacity).toBe(0.4);
    expect(layer.blendMode).toBe("multiply");
  });

  it("opacity 滑桿式連續變更合併為一步", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = doc.layers[0];
    setLayerProps(ctx, layer.id, { opacity: 0.9 });
    setLayerProps(ctx, layer.id, { opacity: 0.7 });
    setLayerProps(ctx, layer.id, { opacity: 0.5 });

    history.undo();
    expect(layer.opacity).toBe(1); // 一步回到最初
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(layer.opacity).toBe(0.5); // 一步到最新
  });

  it("不同屬性組不互相合併", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = doc.layers[0];
    setLayerProps(ctx, layer.id, { opacity: 0.5 });
    setLayerProps(ctx, layer.id, { visible: false });
    history.undo();
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(0.5); // 只回退 visible 那步
  });

  it("值未變時 no-op 不記歷史", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    expect(setLayerProps(ctx, doc.layers[0].id, { opacity: 1, visible: true })).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
