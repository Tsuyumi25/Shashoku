import type { RasterLayerEntry } from "@shared/page/types";
import type { BlendMode } from "./blend";
import type { RasterLayer } from "./types";

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function createRasterLayer(name: string, w: number, h: number): RasterLayer {
  return {
    id: nextId("layer"),
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    locked: false,
    alphaLocked: false,
    data: new Uint8ClampedArray(w * h * 4), // 全 0 = 全透明
  };
}

/** 從已解碼的 ImageBitmap 烤出一個不透明底圖層（畫進暫存 canvas 再取 ImageData）。 */
export function rasterLayerFromBitmap(
  name: string,
  bitmap: ImageBitmap,
  w: number,
  h: number,
): RasterLayer {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return {
    id: nextId("layer"),
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    locked: false,
    alphaLocked: false,
    data: img.data,
  };
}

/**
 * 從 manifest.json 的 RasterLayerEntry + 對應 PNG bitmap 還原一個 RasterLayer。
 * id 沿用 manifest 的 UUID(不再 generate),讓下次 write 出去的 manifest 對齊。
 * 這是 autosave load 路徑的入口;呼叫端負責先過濾 kind==='raster'。
 */
export function rasterLayerFromEntry(
  entry: RasterLayerEntry,
  bitmap: ImageBitmap,
  w: number,
  h: number,
): RasterLayer {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return {
    id: entry.id,
    name: entry.name,
    visible: entry.visible,
    opacity: entry.opacity,
    // manifest 白名單已驗過 blendMode,這裡 cast 進 engine 的 BlendMode
    blendMode: entry.blendMode as BlendMode,
    locked: entry.locked,
    alphaLocked: entry.alphaLocked,
    data: img.data,
  };
}
