import { computed, ref, shallowRef } from "vue";
import type { ShashokuDoc } from "@/engine/document";
import type { RasterLayer } from "@/engine/types";
import { History } from "./history";
import type { EditorCtx } from "./types";

// 模組級單例:App 與圖層面板共用同一份編輯器狀態(POC 不引入 pinia)。
// doc 用 shallowRef(像素 buffer 不進 Vue 反應系統),結構/屬性變更靠
// layersTick 計數驅動衍生 computed 與縮圖刷新。

const doc = shallowRef<ShashokuDoc | null>(null);
const history = new History();
const layersTick = ref(0);
const activeLayerId = ref("");

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
    history,
    layersTick,
    activeLayerId,
    layers,
    activeLayer,
    canUndo,
    canRedo,
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
