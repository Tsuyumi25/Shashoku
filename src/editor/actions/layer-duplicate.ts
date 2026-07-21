import { createRasterLayer } from "@/engine/layer";
import type { RasterLayer } from "@/engine/types";
import type { EditorCtx } from "../types";

/** 複製圖層(PS Ctrl+J 語意):完整拷貝 buffer 與屬性,插在來源正上方。
 * C1:只複製 raster 節點;非 raster(text / group)不支援 duplicate,回 null。 */
export function duplicateLayer(ctx: EditorCtx, layerId: string): RasterLayer | null {
  const { doc, history } = ctx;
  const src = doc.findRasterLayer(layerId);
  if (!src) return null;
  const index = doc.layerIndex(layerId);

  const copy = createRasterLayer(`${src.name} 拷貝`, doc.width, doc.height);
  copy.data.set(src.data);
  copy.visible = src.visible;
  copy.opacity = src.opacity;
  copy.blendMode = src.blendMode;
  copy.locked = src.locked;
  copy.alphaLocked = src.alphaLocked;

  const at = index + 1;
  doc.insertLayer(copy, at);
  ctx.changed();

  history.push({
    label: "複製圖層",
    undo: () => {
      doc.removeLayer(copy.id);
      ctx.changed();
    },
    redo: () => {
      doc.insertLayer(copy, at);
      ctx.changed();
    },
  });
  return copy;
}
