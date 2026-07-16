import { createRasterLayer } from "@/engine/layer";
import type { RasterLayer } from "@/engine/types";
import type { EditorCtx } from "../types";

/** 取不撞名的預設圖層名:「圖層 N」。 */
function nextName(ctx: EditorCtx): string {
  let n = ctx.doc.layers.length + 1;
  const names = new Set(ctx.doc.layers.map((l) => l.name));
  while (names.has(`圖層 ${n}`)) n++;
  return `圖層 ${n}`;
}

/** 新增空白圖層。預設插在最頂(未指定 index 時)。 */
export function addLayer(
  ctx: EditorCtx,
  opts: { name?: string; index?: number } = {},
): RasterLayer {
  const { doc, history } = ctx;
  const layer = createRasterLayer(opts.name ?? nextName(ctx), doc.width, doc.height);
  const index = opts.index ?? doc.layers.length;

  doc.insertLayer(layer, index);
  ctx.changed();

  history.push({
    label: "新增圖層",
    undo: () => {
      doc.removeLayer(layer.id);
      ctx.changed();
    },
    redo: () => {
      doc.insertLayer(layer, index);
      ctx.changed();
    },
  });
  return layer;
}
