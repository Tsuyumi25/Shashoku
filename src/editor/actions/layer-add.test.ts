import { describe, expect, it } from "vitest";
import { layerNames, makeCtx } from "../test-utils";
import { addLayer } from "./layer-add";

describe("addLayer", () => {
  it("預設插在最頂,undo 移除、redo 重插同一物件", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = addLayer(ctx);
    expect(layerNames(doc)).toEqual(["底圖", "圖層 2"]);
    expect(layer.blendMode).toBe("normal");

    history.undo();
    expect(layerNames(doc)).toEqual(["底圖"]);

    history.redo();
    expect(layerNames(doc)).toEqual(["底圖", "圖層 2"]);
    expect(doc.layers[1]).toBe(layer); // 同一物件,buffer 不重建
  });

  it("可指定 index 與名稱;預設名跳過撞名", () => {
    const { ctx, doc } = makeCtx(["底圖", "圖層 2"]);
    addLayer(ctx, { index: 1 });
    expect(layerNames(doc)).toEqual(["底圖", "圖層 3", "圖層 2"]);
    addLayer(ctx, { name: "網點" });
    expect(layerNames(doc).at(-1)).toBe("網點");
  });

  it("觸發 changed 通知", () => {
    const { ctx, changed, history } = makeCtx();
    addLayer(ctx);
    expect(changed).toHaveBeenCalledTimes(1);
    history.undo();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
