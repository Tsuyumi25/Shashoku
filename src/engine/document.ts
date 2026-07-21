import type { RasterLayer, Rect } from "./types";
import type { Layer } from "./layer-tree";
import { isRasterLayer } from "./layer-tree";
import { toCompositeOp } from "./blend";
import { createRasterLayer, rasterLayerFromBitmap } from "./layer";

interface LayerCache {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  /** 直接包在 layer.data 上的 ImageData —— 兩者共享同一份記憶體。 */
  image: ImageData;
}

/**
 * 文件模型:一棵圖層樹(C1 現況:root 全部是 raster leaf,沒有真正巢狀
 * 或 text / group 節點——那些留給 C2 起串接)。每個 raster 有自己的 buffer
 * 是真相,外加一個 canvas 快取供 drawImage 合成:像素編輯寫 buffer 的
 * dirty-rect,再 putImageData 那一小塊到 layer canvas;顯示與匯出都靠
 * drawImage 疊 layer canvas(對齊 BitMappery/zcanvas)。
 *
 * 文字不在這層——標籤是 projectStore 的 SSOT,由 mode 層畫進合成
 * (見 compositeInto 的 interleave hook)。C2 之後 text 才會作為 tree
 * 節點站進 z-order。
 */
export class ShashokuDoc {
  readonly width: number;
  readonly height: number;
  layers: Layer[] = [];

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

  /**
   * C1 現況:內部 API 保留扁平 root 語意——所有 insert / remove / move 只
   * 動 `this.layers` 陣列頭,不遞迴走 nested group。C2 才會做 tree walk。
   */

  /** 在 index 插入既有 layer 節點(bottom→top 序)。undo 重插同一物件即可。
   * text / group 節點不會有 canvas cache——那些是 z-order 位置持有者,合成
   * 時另外處理。 */
  insertLayer(layer: Layer, index: number): void {
    const i = Math.max(0, Math.min(index, this.layers.length));
    this.layers.splice(i, 0, layer);
    if (isRasterLayer(layer) && !this.cache.has(layer.id)) this.initCache(layer);
  }

  /** 移除並回傳 {layer, index};找不到回 null。cache 一併釋放(重插會重建)。 */
  removeLayer(layerId: string): { layer: Layer; index: number } | null {
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

  /** 找節點(C1 只走 root;C2 起會遞迴 tree walk)。 */
  findLayer(layerId: string): Layer | undefined {
    return this.layers.find((l) => l.id === layerId);
  }

  /** 找 raster leaf 節點——非 raster 或找不到都回 undefined。 */
  findRasterLayer(layerId: string): RasterLayer | undefined {
    const l = this.findLayer(layerId);
    return l && isRasterLayer(l) ? l : undefined;
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
    // C1:只 raster 之間能合(text/group 進 tree 後 merge 語意另議);非 raster
    // 拒絕合併。
    if (!isRasterLayer(top) || !isRasterLayer(below)) return false;

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

  /** 抽出某層的 alpha channel(w*h bytes)——Ctrl+click 縮圖載入選區的原語。
   * 非 raster 節點(text / group)不參與 alpha 選區,回 null。 */
  extractAlpha(layerId: string): Uint8ClampedArray | null {
    const layer = this.findRasterLayer(layerId);
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
   * 顯示合成:遞迴 walk tree,由下往上疊像素。
   *
   * - raster leaf:drawImage 該層的 canvas 快取(帶 opacity 與 blend mode)
   * - text node:呼叫 opts.drawText hook,把 labelId 交給外面畫——engine
   *   完全不認識 label 內容(text / x / y / 樣式仍在 pinia SSOT),只知道
   *   「這個 z 位置有一段文字要畫」
   * - group node:遞迴 children(Tier 2 邊界:不做離屏合成,一般 group
   *   是純 z-order 容器)
   *
   * Tier 2 邊界:blend 全走 canvas 原生運算子,無巢狀離屏合成——group
   * 的 opacity/blendMode 對 children 不做整組 blend,只是視覺分組。
   */
  compositeInto(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    opts: {
      drawText?: (
        ctx2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        labelId: string,
      ) => void;
    } = {},
  ): void {
    ctx.clearRect(0, 0, this.width, this.height);
    this.compositeWalk(ctx, this.layers, opts);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private compositeWalk(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    nodes: readonly Layer[],
    opts: {
      drawText?: (
        ctx2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        labelId: string,
      ) => void;
    },
  ): void {
    for (const layer of nodes) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (!layer.visible) continue;
      if (layer.kind === "raster") {
        if (layer.opacity === 0) continue;
        const canvas = this.cache.get(layer.id)?.canvas;
        if (!canvas) continue;
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = toCompositeOp(layer.blendMode);
        ctx.drawImage(canvas, 0, 0);
      } else if (layer.kind === "text") {
        opts.drawText?.(ctx, layer.labelId);
      } else {
        this.compositeWalk(ctx, layer.children, opts);
      }
    }
  }

  /**
   * 把 sidecar 回來的 RGBA 補丁(base64 PNG,mask 外 alpha=0)貼進圖層。
   * alpha 是 0/255 二值:有值處直接覆蓋(最新去字結果為準),其餘不動。
   */
  async blitPngPatch(layerId: string, r: Rect, pngBase64: string): Promise<void> {
    const layer = this.findRasterLayer(layerId);
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

  /**
   * 匯出單一圖層的 PNG bytes(不壓平、保留透明 alpha),供 autosave 落地至
   * pages/<n>/layers/<file>.png 使用。與 exportPng() 的差別:那個是合成後
   * 白底攤平(供交付),這個是各層獨立(供持久化)。
   */
  async exportLayerPng(layerId: string): Promise<Uint8Array> {
    const layer = this.findRasterLayer(layerId);
    if (!layer) throw new Error(`exportLayerPng: raster layer 不存在 ${layerId}`);
    const canvas = new OffscreenCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d")!;
    // 直接 putImageData:layer.data 已是 RGBA 直通 alpha,不經 blend/opacity(那是合成端的事)
    const image = new ImageData(
      layer.data as Uint8ClampedArray<ArrayBuffer>,
      this.width,
      this.height,
    );
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
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
