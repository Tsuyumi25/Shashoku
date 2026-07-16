import type { EditorCtx } from "../types";

/**
 * Merge down(PS 語意):把該層以自身 opacity/blendMode 合成進正下方那層,
 * 然後移除自己。破壞性操作——undo 需要下方層合成前的完整 buffer 備份
 * (每次約一層大小的記憶體,由 history 上限自然回收)。
 */
export function mergeLayerDown(ctx: EditorCtx, layerId: string): boolean {
  const { doc, history } = ctx;
  const index = doc.layerIndex(layerId);
  if (index <= 0) return false;

  const top = doc.layers[index];
  const below = doc.layers[index - 1];
  const belowBackup = below.data.slice();
  const fullRect = { x: 0, y: 0, w: doc.width, h: doc.height };

  if (!doc.mergeDown(layerId)) return false;
  ctx.changed();

  history.push({
    label: "向下合併圖層",
    undo: () => {
      below.data.set(belowBackup);
      doc.syncLayer(below.id, fullRect);
      doc.insertLayer(top, index);
      ctx.changed();
    },
    redo: () => {
      doc.mergeDown(top.id); // 決定性運算,重算即可,不用存合併結果
      ctx.changed();
    },
  });
  return true;
}
