import { computed, ref, shallowRef } from "vue";
import type { ShashokuDoc } from "@/engine/document";
import { boundsOfMask } from "@/engine/selection";
import type { RasterLayer, Rect } from "@/engine/types";
import { History } from "./history";
import type { EditorCtx } from "./types";

// 模組級單例:App 與圖層面板共用同一份編輯器狀態(POC 不引入 pinia)。
// doc 用 shallowRef(像素 buffer 不進 Vue 反應系統),結構/屬性變更靠
// tick counter 驅動衍生 computed 與縮圖刷新。
//
// 兩條 tick 分工:
// - layersTick:UI 需要重繪/重算的訊號(面板、縮圖、canvas)。載入頁、
//   pixel change、layer CRUD 都會 tick——因為畫面呈現的東西變了。
// - rasterDirtyTick:磁碟持久化狀態變髒的訊號(觸發 raster autosave)。
//   只有真正 mutate 到 pixel 或 manifest 內容時才 tick;純載入頁不 tick。
// 拆兩個 tick 是為了避免「打開一頁就 autosave 覆寫」的規避 case。

const doc = shallowRef<ShashokuDoc | null>(null);
/** doc 對應的專案頁檔名(單檔模式 = null)。校對 mode 靠它判斷 doc 可不可用。 */
const docPage = shallowRef<string | null>(null);
const history = new History();
const layersTick = ref(0);
const rasterDirtyTick = ref(0);
const activeLayerId = ref("");

// 選區:整頁 8-bit soft mask,null = 無選區(不約束)。bounds 供蟻線/清除用。
const selection = shallowRef<Uint8ClampedArray | null>(null);
const selectionBounds = shallowRef<Rect | null>(null);

function setSelection(mask: Uint8ClampedArray | null): void {
  const d = doc.value;
  if (!mask || !d) {
    selection.value = null;
    selectionBounds.value = null;
    return;
  }
  const b = boundsOfMask(mask, d.width, d.height);
  if (!b) {
    // 全空 mask = 取消選區(PS 語意:沒有「選了零像素」這種狀態)
    selection.value = null;
    selectionBounds.value = null;
    return;
  }
  selection.value = mask;
  selectionBounds.value = b;
}

let redrawCanvas: () => void = () => {};

/**
 * 變更通知:面板重算 + canvas 重繪。actions 的 undo/redo 閉包也走這裡。
 *
 * opts.raster (預設 true):是否為 raster 持久化狀態的變更。
 * - 塗抹、layer CRUD、undo/redo:預設 true → 觸發 autosave
 * - 純 UI 刷新(如載入頁完成後叫面板重繪):傳 false → 不觸發 autosave
 */
function changed(opts: { raster?: boolean } = {}): void {
  layersTick.value++;
  if (opts.raster !== false) rasterDirtyTick.value++;
  redrawCanvas();
}

// C1:doc.layers 已升 Layer[] tree,但 useEditor 對外只暴露 raster leaf
// ——LayerPanel 等 UI 目前僅懂 raster;text / group 節點的呈現留 C3。
const layers = computed<RasterLayer[]>(() => {
  void layersTick.value;
  if (!doc.value) return [];
  return doc.value.layers.filter((l): l is RasterLayer => l.kind === "raster");
});

const activeLayer = computed<RasterLayer | null>(() => {
  void layersTick.value;
  return doc.value?.findRasterLayer(activeLayerId.value) ?? null;
});

const canUndo = computed(() => {
  void layersTick.value;
  return history.canUndo;
});

const canRedo = computed(() => {
  void layersTick.value;
  return history.canRedo;
});

export function useEditor() {
  return {
    doc,
    docPage,
    history,
    layersTick,
    rasterDirtyTick,
    activeLayerId,
    layers,
    activeLayer,
    canUndo,
    canRedo,
    selection,
    selectionBounds,
    setSelection,
    changed,
    setRedraw(fn: () => void): void {
      redrawCanvas = fn;
    },
    /** 取 actions 的執行環境。doc 未載入時不可呼叫。 */
    ctx(): EditorCtx {
      if (!doc.value) throw new Error("no document loaded");
      return { doc: doc.value, history, changed };
    },
    undo(): boolean {
      return history.undo(); // entry 的閉包自己會呼叫 changed()
    },
    redo(): boolean {
      return history.redo();
    },
  };
}
