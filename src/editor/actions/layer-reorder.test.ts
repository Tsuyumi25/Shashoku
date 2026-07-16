import { describe, expect, it } from "vitest";
import { layerNames, makeCtx } from "../test-utils";
import { reorderLayer } from "./layer-reorder";

describe("reorderLayer", () => {
  it("搬移 stack 索引,undo 精確還原", () => {
    const { ctx, doc, history } = makeCtx(["a", "b", "c", "d"]);
    expect(reorderLayer(ctx, 0, 2)).toBe(true);
    expect(layerNames(doc)).toEqual(["b", "c", "a", "d"]);

    history.undo();
    expect(layerNames(doc)).toEqual(["a", "b", "c", "d"]);
    history.redo();
    expect(layerNames(doc)).toEqual(["b", "c", "a", "d"]);
  });

  it("往下搬同樣可逆", () => {
    const { ctx, doc, history } = makeCtx(["a", "b", "c"]);
    reorderLayer(ctx, 2, 0);
    expect(layerNames(doc)).toEqual(["c", "a", "b"]);
    history.undo();
    expect(layerNames(doc)).toEqual(["a", "b", "c"]);
  });

  it("同位或越界回 false 且不記歷史", () => {
    const { ctx, history } = makeCtx(["a", "b"]);
    expect(reorderLayer(ctx, 1, 1)).toBe(false);
    expect(reorderLayer(ctx, -1, 0)).toBe(false);
    expect(reorderLayer(ctx, 0, 5)).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
