import type { EditorCtx } from "../types";

/** 刪除圖層。最後一層不可刪(文件不能沒有圖層)。undo 重插同一物件。 */
export function removeLayer(ctx: EditorCtx, layerId: string): boolean {
  const { doc, history } = ctx;
  if (doc.layers.length <= 1) return false;

  const removed = doc.removeLayer(layerId);
  if (!removed) return false;
  ctx.changed();

  const { layer, index } = removed;
  history.push({
    label: "刪除圖層",
    undo: () => {
      doc.insertLayer(layer, index);
      ctx.changed();
    },
    redo: () => {
      doc.removeLayer(layer.id);
      ctx.changed();
    },
  });
  return true;
}
