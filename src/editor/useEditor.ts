import { computed, ref, shallowRef } from "vue";
import type { ShashokuDoc } from "@/engine/document";
import { boundsOfMask } from "@/engine/selection";
import type { RasterLayer, Rect } from "@/engine/types";
import { History } from "./history";
import type { EditorCtx } from "./types";

// 模組級單例:App 與圖層面板共用同一份編輯器狀態(POC 不引入 pinia)。
// doc 用 shallowRef(像素 buffer 不進 Vue 反應系統),結構/屬性變更靠
// layersTick 計數驅動衍生 computed 與縮圖刷新。

const doc = shallowRef<ShashokuDoc | null>(null);
/** doc 對應的專案頁檔名(單檔模式 = null)。校對 mode 靠它判斷 doc 可不可用。 */
const docPage = shallowRef<string | null>(null);
const history = new History();
const layersTick = ref(0);
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

/** 變更通知:面板重算 + canvas 重繪。actions 的 undo/redo 閉包也走這裡。 */
function changed(): void {
  layersTick.value++;
  redrawCanvas();
}

const layers = computed<RasterLayer[]>(() => {
  void layersTick.value;
  return doc.value ? [...doc.value.layers] : [];
});

const activeLayer = computed<RasterLayer | null>(() => {
  void layersTick.value;
  return doc.value?.layers.find((l) => l.id === activeLayerId.value) ?? null;
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
