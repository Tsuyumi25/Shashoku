import type { RasterLayer, Rect, TextObject } from "./types";
import { createRasterLayer, rasterLayerFromBitmap } from "./layer";
import { renderTexts } from "./text";

interface LayerCache {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  /** 直接包在 layer.data 上的 ImageData —— 兩者共享同一份記憶體。 */
  image: ImageData;
}

/**
 * 文件模型:一疊 raster 圖層(每層 buffer 是真相,外加一個 canvas 快取供 drawImage
 * 合成)+ 一組文字物件。像素編輯寫 buffer 的 dirty-rect,再 putImageData 那一小塊
 * 到 layer canvas;顯示與匯出都靠 drawImage 疊 layer canvas(對齊 BitMappery/zcanvas)。
 */
export class ShashokuDoc {
  readonly width: number;
  readonly height: number;
  layers: RasterLayer[] = [];
  texts: TextObject[] = [];

  private cache = new Map<string, LayerCache>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private initCache(layer: RasterLayer): void {
    const canvas = new OffscreenCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d")!;
    // 零拷貝:ImageData 直接包在 layer.data 上,寫 buffer 就等於改 image。
    // TS 5.9 的 lib.dom 把 ImageDataArray 收窄成 <ArrayBuffer>,而 getImageData()
    // 給的是 <ArrayBufferLike>,執行期相容,型別上做一次向下轉。
    const image = new ImageData(
      layer.data as Uint8ClampedArray<ArrayBuffer>,
      this.width,
      this.height,
    );
    ctx.putImageData(image, 0, 0);
    this.cache.set(layer.id, { canvas, ctx, image });
  }

  addLayerFromBitmap(name: string, bitmap: ImageBitmap): RasterLayer {
    const layer = rasterLayerFromBitmap(name, bitmap, this.width, this.height);
    this.layers.push(layer);
    this.initCache(layer);
    return layer;
  }

  addBlankLayer(name: string): RasterLayer {
    const layer = createRasterLayer(name, this.width, this.height);
    this.layers.push(layer);
    this.initCache(layer);
    return layer;
  }

  /** 把某層 buffer 的 dirty-rect 推進它的 canvas 快取(只搬那一塊)。 */
  syncLayer(layerId: string, r: Rect): void {
    if (r.w === 0 || r.h === 0) return;
    const c = this.cache.get(layerId);
    if (!c) return;
    c.ctx.putImageData(c.image, 0, 0, r.x, r.y, r.w, r.h);
  }

  layerCanvas(layerId: string): OffscreenCanvas | undefined {
    return this.cache.get(layerId)?.canvas;
  }

  /**
   * 顯示合成:清空 target,由下往上 drawImage 每個可見圖層,最後畫文字。
   * globalAlpha 帶圖層不透明度。之後要 PS 混合模式就在這裡設 globalCompositeOperation。
   */
  compositeInto(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      const canvas = this.cache.get(layer.id)?.canvas;
      if (!canvas) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    renderTexts(ctx as CanvasRenderingContext2D, this.texts);
  }

  /** 匯出壓平成 PNG blob(白底,漫畫頁通常不要透明)。 */
  async exportPng(background = "#ffffff"): Promise<Blob> {
    const canvas = new OffscreenCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.compositeInto(ctx);
    return canvas.convertToBlob({ type: "image/png" });
  }
}
