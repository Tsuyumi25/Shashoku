import { computed, ref, shallowRef } from "vue";
import type { ShashokuDoc } from "@/engine/document";
import type { Layer } from "@/engine/layer-tree";
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
// 多選:圖層面板可以 Ctrl / Shift 選一坨。activeLayerId 是「主要」 = 最後
// 加入 Set 的 id,供既有 single-target 呼叫端(painting / merge-down / duplicate
// 這些)向下相容。整個 useEditor 對外 API 沒變,但 API 呼叫 activeLayerId = X
// 會變成「單選 X」(清空 Set 再加 X)。
const activeLayerIds = ref<Set<string>>(new Set());

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

// `layers`(raster-only 扁平):給既有 raster CRUD action / thumb / blend
// 面板用——它們對 text / group 節點無語意。
// `tree`(union 遞迴):給 LayerPanel 的 nested 呈現用(C3 起)。
const layers = computed<RasterLayer[]>(() => {
  void layersTick.value;
  if (!doc.value) return [];
  return doc.value.layers.filter((l): l is RasterLayer => l.kind === "raster");
});

const tree = computed<Layer[]>(() => {
  void layersTick.value;
  return doc.value?.layers ?? [];
});

/** 主要選中 layer id(= Set 最後加入的);空字串 = 沒選 */
const activeLayerId = computed<string>({
  get: () => {
    let last = "";
    for (const id of activeLayerIds.value) last = id;
    return last;
  },
  set: (id: string) => {
    // 單選語意:清空 + 只留這個(向下相容既有呼叫)
    activeLayerIds.value = new Set(id ? [id] : []);
  },
});

/** 把 id toggle 進 / 出 selection Set(Ctrl+click 用)。 */
function toggleActiveLayer(id: string): void {
  const next = new Set(activeLayerIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  activeLayerIds.value = next;
}

/** 一次設多個(Shift+click 範圍選 / 拖曳完畢維持選中 用)。 */
function setActiveLayers(ids: readonly string[]): void {
  activeLayerIds.value = new Set(ids);
}

const activeLayer = computed<RasterLayer | null>(() => {
  void layersTick.value;
  return doc.value?.findRasterLayer(activeLayerId.value) ?? null;
});

/** 選中的 raster layers(text/group 節點過濾掉——非 raster 沒有 blend/opacity 這些屬性)。
 *  header controls 用這個來判斷 mixed。 */
const activeRasterLayers = computed<RasterLayer[]>(() => {
  void layersTick.value;
  const d = doc.value;
  if (!d) return [];
  const out: RasterLayer[] = [];
  for (const id of activeLayerIds.value) {
    const l = d.findRasterLayer(id);
    if (l) out.push(l);
  }
  return out;
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
    activeLayerIds,
    toggleActiveLayer,
    setActiveLayers,
    layers,
    tree,
    activeLayer,
    activeRasterLayers,
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
