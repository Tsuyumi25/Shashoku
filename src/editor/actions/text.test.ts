import { describe, expect, it } from "vitest";
import type { TextObject } from "@/engine/types";
import { makeCtx } from "../test-utils";
import { addText, editText, moveText, removeText } from "./text";

function t(id: string, x = 10, y = 10): TextObject {
  return { id, x, y, text: "あ", fontSizePx: 24, fontFamily: "sans-serif", color: "#000", direction: "vertical" };
}

describe("text actions", () => {
  it("addText / removeText 可 undo/redo", () => {
    const { ctx, doc, history } = makeCtx();
    addText(ctx, t("t1"));
    expect(doc.texts).toHaveLength(1);
    history.undo();
    expect(doc.texts).toHaveLength(0);
    history.redo();
    expect(doc.texts).toHaveLength(1);

    removeText(ctx, "t1");
    expect(doc.texts).toHaveLength(0);
    history.undo();
    expect(doc.texts[0].id).toBe("t1");
  });

  it("moveText:拖曳結束記一步,undo 回起點;原地拖曳 no-op", () => {
    const { ctx, doc, history } = makeCtx();
    doc.texts.push(t("t1", 10, 10));
    const text = doc.texts[0];
    text.x = 50;
    text.y = 60; // 拖曳過程直接改(不入史)
    expect(moveText(ctx, "t1", { x: 10, y: 10 })).toBe(true);

    history.undo();
    expect(text.x).toBe(10);
    expect(text.y).toBe(10);
    history.redo();
    expect(text.x).toBe(50);

    expect(moveText(ctx, "t1", { x: 50, y: 60 })).toBe(false); // 沒動
  });

  it("editText:同欄位連續輸入合併為一步", () => {
    const { ctx, doc, history } = makeCtx();
    doc.texts.push(t("t1"));
    const text = doc.texts[0];

    text.text = "あい";
    editText(ctx, "t1", { text: "あい" }, { text: "あ" });
    text.text = "あいう";
    editText(ctx, "t1", { text: "あいう" }, { text: "あい" });

    history.undo();
    expect(text.text).toBe("あ"); // 一步回最初
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(text.text).toBe("あいう");
  });
});
