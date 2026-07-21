import { copyRect, writeRect } from "@/engine/pixelPatch";
import type { Rect } from "@/engine/types";
import type { EditorCtx } from "./types";

export interface PixelPatch {
  rect: Rect;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

/**
 * 把一段像素變更(筆刷筆劃/網點填充/去字補丁)記進歷史。
 * 呼叫時像素已是「after」狀態;before 由呼叫端在動筆前抄好。
 * undo/redo 都只寫回 rect 區域 + dirty-rect 同步,不碰整層。
 */
export function pushPixelPatch(
  ctx: EditorCtx,
  layerId: string,
  rect: Rect,
  before: Uint8ClampedArray,
  label: string,
): void {
  const { doc, history } = ctx;
  const layer = doc.findRasterLayer(layerId);
  if (!layer || rect.w <= 0 || rect.h <= 0) return;
  const after = copyRect(layer.data, doc.width, rect);

  const apply = (patch: Uint8ClampedArray) => {
    const target = doc.findRasterLayer(layerId);
    if (!target) return; // 層已被刪(跨步驟互動),安全跳過
    writeRect(target.data, doc.width, rect, patch);
    doc.syncLayer(layerId, rect);
    ctx.changed();
  };

  history.push({
    label,
    undo: () => apply(before),
    redo: () => apply(after),
  });
}

/** 多個不相鄰補丁收成一步(整批去字 = 一次 Ctrl+Z)。 */
export function pushPixelPatches(
  ctx: EditorCtx,
  layerId: string,
  patches: PixelPatch[],
  label: string,
): void {
  const { doc, history } = ctx;
  const valid = patches.filter((p) => p.rect.w > 0 && p.rect.h > 0);
  if (valid.length === 0) return;

  const apply = (side: "before" | "after") => {
    const target = doc.findRasterLayer(layerId);
    if (!target) return;
    for (const p of valid) {
      writeRect(target.data, doc.width, p.rect, p[side]);
      doc.syncLayer(layerId, p.rect);
    }
    ctx.changed();
  };

  history.push({
    label,
    undo: () => apply("before"),
    redo: () => apply("after"),
  });
}
