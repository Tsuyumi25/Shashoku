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
