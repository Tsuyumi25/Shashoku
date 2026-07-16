import type { EditorCtx } from "../types";

/** 改名(雙擊圖層名)。同層連續改名在合併窗內收成一步。 */
export function renameLayer(ctx: EditorCtx, layerId: string, name: string): boolean {
  const { doc, history } = ctx;
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.name === name) return false;

  const prev = layer.name;
  layer.name = name;
  ctx.changed();

  history.push({
    label: "重新命名圖層",
    mergeKey: `rename:${layerId}`,
    undo: () => {
      layer.name = prev;
      ctx.changed();
    },
    redo: () => {
      layer.name = name;
      ctx.changed();
    },
  });
  return true;
}
