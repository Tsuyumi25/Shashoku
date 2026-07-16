import type { TextObject } from "@/engine/types";
import type { EditorCtx } from "../types";

// 文字物件的操作入史。文字是輕量物件(非像素),undo 直接存值。

export function addText(ctx: EditorCtx, text: TextObject): void {
  const { doc, history } = ctx;
  doc.texts.push(text);
  ctx.changed();
  history.push({
    label: "新增文字",
    undo: () => {
      doc.texts = doc.texts.filter((t) => t.id !== text.id);
      ctx.changed();
    },
    redo: () => {
      doc.texts.push(text);
      ctx.changed();
    },
  });
}

export function removeText(ctx: EditorCtx, textId: string): boolean {
  const { doc, history } = ctx;
  const index = doc.texts.findIndex((t) => t.id === textId);
  if (index < 0) return false;
  const [text] = doc.texts.splice(index, 1);
  ctx.changed();
  history.push({
    label: "刪除文字",
    undo: () => {
      doc.texts.splice(index, 0, text);
      ctx.changed();
    },
    redo: () => {
      doc.texts = doc.texts.filter((t) => t.id !== text.id);
      ctx.changed();
    },
  });
  return true;
}

/** 拖曳結束時記一步:from 是拖曳起點(呼叫端在 pointerdown 時抄下)。 */
export function moveText(
  ctx: EditorCtx,
  textId: string,
  from: { x: number; y: number },
): boolean {
  const { doc, history } = ctx;
  const text = doc.texts.find((t) => t.id === textId);
  if (!text || (text.x === from.x && text.y === from.y)) return false;
  const to = { x: text.x, y: text.y };
  history.push({
    label: "移動文字",
    undo: () => {
      text.x = from.x;
      text.y = from.y;
      ctx.changed();
    },
    redo: () => {
      text.x = to.x;
      text.y = to.y;
      ctx.changed();
    },
  });
  return true;
}

/** 內容/樣式變更。同物件同欄位的連續輸入(打字、拉字級)合併為一步。 */
export function editText(
  ctx: EditorCtx,
  textId: string,
  patch: Partial<Pick<TextObject, "text" | "fontSizePx" | "fontFamily" | "color" | "direction">>,
  prev: typeof patch,
): boolean {
  const { doc, history } = ctx;
  const text = doc.texts.find((t) => t.id === textId);
  if (!text) return false;
  const keys = Object.keys(patch).join(",");
  history.push({
    label: "編輯文字",
    mergeKey: `text:${textId}:${keys}`,
    undo: () => {
      Object.assign(text, prev);
      ctx.changed();
    },
    redo: () => {
      Object.assign(text, patch);
      ctx.changed();
    },
  });
  return true;
}
