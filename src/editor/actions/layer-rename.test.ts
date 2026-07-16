import { describe, expect, it } from "vitest";
import { makeCtx } from "../test-utils";
import { renameLayer } from "./layer-rename";

describe("renameLayer", () => {
  it("改名可 undo/redo", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = doc.layers[0];
    renameLayer(ctx, layer.id, "背景");
    expect(layer.name).toBe("背景");
    history.undo();
    expect(layer.name).toBe("底圖");
    history.redo();
    expect(layer.name).toBe("背景");
  });

  it("同層連續改名合併為一步(undo 直接回最初)", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    const layer = doc.layers[0];
    renameLayer(ctx, layer.id, "背");
    renameLayer(ctx, layer.id, "背景");
    renameLayer(ctx, layer.id, "背景層");
    expect(layer.name).toBe("背景層");

    history.undo();
    expect(layer.name).toBe("底圖");
    expect(history.canUndo).toBe(false); // 三次改名收成一步
  });

  it("同名 no-op", () => {
    const { ctx, doc, history } = makeCtx(["底圖"]);
    expect(renameLayer(ctx, doc.layers[0].id, "底圖")).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
