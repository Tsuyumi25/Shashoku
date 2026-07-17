import type { RasterLayer, Rect } from "./types";
import { toCompositeOp } from "./blend";
import { createRasterLayer, rasterLayerFromBitmap } from "./layer";

interface LayerCache {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  /** 直接包在 layer.data 上的 ImageData —— 兩者共享同一份記憶體。 */
  image: ImageData;
}

/**
 * 文件模型:一疊 raster 圖層(每層 buffer 是真相,外加一個 canvas 快取供 drawImage
 * 合成)。像素編輯寫 buffer 的 dirty-rect,再 putImageData 那一小塊到 layer canvas;
 * 顯示與匯出都靠 drawImage 疊 layer canvas(對齊 BitMappery/zcanvas)。
 * 文字不在這層——標籤是 projectStore 的 SSOT,由 mode 層畫進合成(見 compositeInto)。
 */
export class ShashokuDoc {
  readonly width: number;
  readonly height: number;
  layers: RasterLayer[] = [];

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
    this.insertLayer(layer, this.layers.length);
    return layer;
  }

  addBlankLayer(name: string): RasterLayer {
    const layer = createRasterLayer(name, this.width, this.height);
    this.insertLayer(layer, this.layers.length);
    return layer;
  }

  // ---- 結構操作(供 editor actions 呼叫;各自是可逆的最小步) ----

  /** 在 index 插入既有 layer 物件(bottom→top 序)。undo 重插同一物件即可。 */
  insertLayer(layer: RasterLayer, index: number): void {
    const i = Math.max(0, Math.min(index, this.layers.length));
    this.layers.splice(i, 0, layer);
    if (!this.cache.has(layer.id)) this.initCache(layer);
  }

  /** 移除並回傳 {layer, index};找不到回 null。cache 一併釋放(重插會重建)。 */
  removeLayer(layerId: string): { layer: RasterLayer; index: number } | null {
    const index = this.layers.findIndex((l) => l.id === layerId);
    if (index < 0) return null;
    const [layer] = this.layers.splice(index, 1);
    this.cache.delete(layer.id);
    return { layer, index };
  }

  moveLayer(from: number, to: number): void {
    if (from === to || from < 0 || from >= this.layers.length) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(Math.max(0, Math.min(to, this.layers.length)), 0, layer);
  }

  layerIndex(layerId: string): number {
    return this.layers.findIndex((l) => l.id === layerId);
  }

  /**
   * Merge down(PS 語意):把該層以自己的 opacity/blendMode 合成進正下方那層,
   * 然後移除自己。下方層的 buffer 被覆寫——呼叫端(action)負責先備份以供 undo。
   */
  mergeDown(layerId: string): boolean {
    const index = this.layerIndex(layerId);
    if (index <= 0) return false; // 最底層沒有「下方」
    const top = this.layers[index];
    const below = this.layers[index - 1];

    const c = new OffscreenCanvas(this.width, this.height);
    const ctx = c.getContext("2d")!;
    const belowCanvas = this.cache.get(below.id)?.canvas;
    const topCanvas = this.cache.get(top.id)?.canvas;
    if (belowCanvas) ctx.drawImage(belowCanvas, 0, 0);
    if (topCanvas) {
      ctx.globalAlpha = top.opacity;
      ctx.globalCompositeOperation = toCompositeOp(top.blendMode);
      ctx.drawImage(topCanvas, 0, 0);
    }
    const merged = ctx.getImageData(0, 0, this.width, this.height);
    below.data.set(merged.data);
    this.syncLayer(below.id, { x: 0, y: 0, w: this.width, h: this.height });
    this.removeLayer(top.id);
    return true;
  }

  /** 抽出某層的 alpha channel(w*h bytes)——Ctrl+click 縮圖載入選區的原語。 */
  extractAlpha(layerId: string): Uint8ClampedArray | null {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    const n = this.width * this.height;
    const out = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) out[i] = layer.data[i * 4 + 3];
    return out;
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
   * 顯示合成:清空 target,由下往上 drawImage 每個可見圖層(帶 opacity 與
   * blend mode)。Tier 2 邊界:blend 全走 canvas 原生運算子,無巢狀群組
   * → 不需要離屏遞迴。
   *
   * interleave:畫第 index 層之前的插畫 hook(不可見層也會呼叫,錨定語義
   * 以堆疊位置為準)。mode 層用它把「錨進堆疊的標籤文字」drawElementImage
   * 進正確的 z 位置——engine 只知道「有東西要插在層與層之間」,不知道文字。
   */
  compositeInto(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    interleave?: (ctx2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, beforeLayerIndex: number) => void,
  ): void {
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      interleave?.(ctx, i);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (!layer.visible || layer.opacity === 0) continue;
      const canvas = this.cache.get(layer.id)?.canvas;
      if (!canvas) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = toCompositeOp(layer.blendMode);
      ctx.drawImage(canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // 文字由 mode 層畫:錨定的走 interleave hook 插層間,浮動的在本函式
    // 返回後畫最上層(drawFloatingTop)——engine 只管像素。
  }

  /**
   * 把 sidecar 回來的 RGBA 補丁(base64 PNG,mask 外 alpha=0)貼進圖層。
   * alpha 是 0/255 二值:有值處直接覆蓋(最新去字結果為準),其餘不動。
   */
  async blitPngPatch(layerId: string, r: Rect, pngBase64: string): Promise<void> {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer || r.w <= 0 || r.h <= 0) return;

    const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const c = new OffscreenCanvas(r.w, r.h);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const src = ctx.getImageData(0, 0, r.w, r.h).data;

    for (let y = 0; y < r.h; y++) {
      let si = y * r.w * 4;
      let di = ((r.y + y) * this.width + r.x) * 4;
      for (let x = 0; x < r.w; x++, si += 4, di += 4) {
        if (src[si + 3] === 0) continue;
        layer.data[di] = src[si];
        layer.data[di + 1] = src[si + 1];
        layer.data[di + 2] = src[si + 2];
        layer.data[di + 3] = 255;
      }
    }
    this.syncLayer(layerId, r);
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
