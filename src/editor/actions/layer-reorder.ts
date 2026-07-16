import type { EditorCtx } from "../types";

/** 重排圖層(拖曳/上移下移)。from/to 都是 bottom→top 的 stack 索引。 */
export function reorderLayer(ctx: EditorCtx, from: number, to: number): boolean {
  const { doc, history } = ctx;
  const n = doc.layers.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return false;

  doc.moveLayer(from, to);
  ctx.changed();

  history.push({
    label: "重排圖層",
    undo: () => {
      doc.moveLayer(to, from);
      ctx.changed();
    },
    redo: () => {
      doc.moveLayer(from, to);
      ctx.changed();
    },
  });
  return true;
}
