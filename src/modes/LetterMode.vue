<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ShashokuDoc } from "@/engine/document";
import { createRasterLayer, rasterLayerFromBitmap, rasterLayerFromEntry } from "@/engine/layer";
import type { RasterLayer } from "@/engine/types";
import type { Layer } from "@/engine/layer-tree";
import { parseManifest, parseOcr, serializeOcr } from "@shared/page/schema";
import { stampBrush } from "@/engine/brush";
import { fillScreentoneRect } from "@/engine/screentone";
import { timeMs } from "@/engine/perf";
import type { Rect } from "@/engine/types";
import { unionRect, EMPTY_RECT } from "@/engine/geom";
import { clamp, screenToContentPx } from "@/lib/coords";
import { sharedView, viewFit } from "@/lib/viewState";
import { hexToRgb } from "@/lib/color";
import { useZoomPan } from "@/composables/useZoomPan";
import { useEditor } from "@/editor/useEditor";
import { addLayer, duplicateLayer } from "@/editor/actions";
import { pushPixelPatch, pushPixelPatches, type PixelPatch } from "@/editor/pixel-history";
import { normalize } from "@/editor/layerTree/normalize";
import { flushPendingRasterSave, scheduleRasterAutosave } from "@/editor/autosave";
import { copyRect } from "@/engine/pixelPatch";
import { clampRect } from "@/engine/geom";
import { clearSelected, fullMask, invertMask, rectMask } from "@/engine/selection";
import { traceMaskOutlines, type Point } from "@/engine/marchingSquares";
import CanvasBottomBar from "@/components/CanvasBottomBar.vue";
import LayerPanel from "@/components/LayerPanel.vue";
import ModeSwitcher from "@/components/ModeSwitcher.vue";
import { appMode } from "@/lib/appMode";
import { effectiveStyleForLabel, labelTextCss } from "@/lib/labelTextStyle";
import { drawLabelElement } from "@/lib/labelPaint";
import { setLabelDragPreview } from "@/lib/labelDragPreview";
import {
  LABEL_DRAG_TYPE,
  parseLabelDrag,
  resolveDropGroupId,
  serializeLabelDrag,
  type LabelDragPayload,
} from "@/lib/labelDrag";
import type { LabelItem } from "@/types/project";
import { useEditorStore } from "@/stores/editorStore";
import { useProjectStore } from "@/stores/projectStore";
import type { OcrBlock } from "@shared/ipc/channels";
import { toast } from "vue-sonner";

type Tool = "move" | "hand" | "brush" | "erase" | "tone" | "text" | "marquee";

// ---- 狀態 ----
// doc / activeLayerId / undo 歷史活在 useEditor 單例,LayerPanel 共用同一份。
const editor = useEditor();
const { doc, activeLayerId, rasterDirtyTick } = editor;
const containerEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const selCanvasEl = ref<HTMLCanvasElement | null>(null); // 選區蟻線 overlay(doc 空間)
let displayCtx: CanvasRenderingContext2D | null = null;

// 去字層惰性建立:第一次 inpaint 才生,插在底圖正上方;跟 doc 同生命週期
let inpaintLayerId: string | null = null;

const tool = ref<Tool>("move"); // PS 慣例:開場是移動工具(home base,絕不誤創建)
const brush = reactive({ size: 22, hardness: 0.85, color: "#e23b3b" });
const tone = reactive({ pitch: 6, angle: 45, density: 0.5, color: "#000000" });

// ---- SSOT 投影:專案/頁/標籤全部以 projectStore(.ssk.json)為準 ----
// 嵌字 mode 不再有自己的文字實體:畫布上的「文字」= 當前頁 labels 的投影,
// 拖曳/編輯直接寫回 projectStore(pinia 響應式 → 翻譯視圖即時跟動),
// undo 進嵌字自己的 History(D3:每 mode 一條棧)。
const projectStore = useProjectStore();
const editorStore = useEditorStore();
const currentPage = computed(() => editorStore.currentFilename); // 頁游標與翻譯共享
const loadedPage = ref<string | null>(null); // 已建成 doc 的頁(惰性重載判斷)
// 標籤/OCR 的讀寫錨在 loadedPage(畫面上這張 doc 的頁),不是 currentPage:
// 游標按下就變、doc 要等載入,錨錯邊會出現「新頁文字疊舊頁底圖」的撕裂幀,
// 寫入端更會把操作寫進還沒顯示的頁。currentPage 只負責導航(頁列表/換頁 watch)
const currentLabels = computed<LabelItem[]>(() =>
  loadedPage.value ? (projectStore.fileByName(loadedPage.value)?.labels ?? []) : [],
);
const selectedLabel = computed<LabelItem | null>(
  () => currentLabels.value.find((l) => l.id === editorStore.selectedLabelId) ?? null,
);
// 文字渲染樣式:走 header 三層繼承鍊 → labelTextCss,per-label 解析,與翻譯
// mode 同一份 CSS = 同一個 Chromium 排版,座標與樣式跨 mode 一致
function cssForLabel(label: LabelItem): Record<string, string> {
  return labelTextCss(effectiveStyleForLabel(label, projectStore.header));
}

// ---- OCR 狀態 ----
const ocrData = reactive<Record<string, OcrBlock[]>>({});
const ocrState = reactive<Record<string, "running" | "done" | "error">>({});
const sidecarStatus = ref("");
const batchRunning = ref(false);
const hoveredBlock = ref<number | null>(null);

const currentBlocks = computed<OcrBlock[]>(() =>
  loadedPage.value ? (ocrData[loadedPage.value] ?? []) : []
);

function blockColor(label: OcrBlock["label"]): string {
  return label === "bubble" ? "#2e9e44" : label === "text_bubble" ? "#e05252" : "#b06fe0";
}

const containerSize = reactive({ w: 1, h: 1 });
const contentSize = computed(() => ({ w: doc.value?.width ?? 1, h: doc.value?.height ?? 1 }));
// 視角是全域狀態(sharedView):與翻譯 mode 共用,切視圖繼承座標與縮放
const { view, fitToView, onWheel, zoomBy, panBy, rotateTo } = useZoomPan(
  containerSize,
  contentSize,
  sharedView,
);

const perf = reactive({
  imageSize: "",
  lastStamp: 0, // 上一次筆刷/網點寫 buffer 的 ms
  lastDraw: 0, // 上一次 drawImage 顯示合成 ms
});

const spaceDown = ref(false);
const toneRect = ref<Rect | null>(null); // 網點/選取拖曳中的預覽(doc 座標)

// R+drag 旋轉視角(PS Rotate View):繞視窗中心,Shift 吸附 15°,Esc 回正
let lastEscAt = 0; // Esc 連按偵測(雙擊窗 400ms)
const rDown = ref(false);
const rotating = ref(false);
let rotatePivot = { x: 0, y: 0 };
let rotateStartAngle = 0;
let rotateStartTheta = 0;

// Alt+右鍵拖曳:HUD 調筆刷大小/硬度(PS 手勢;Alt+左鍵留給吸色)。
// 不檢查 Ctrl——Windows PS 兩派肌肉記憶(Alt+右鍵 / Ctrl+Alt+右鍵)都收。
const brushHud = ref<{ sx: number; sy: number; size0: number; hardness0: number } | null>(null);
const BRUSH_MAX = 500;

// 筆刷游標:實際落筆尺寸的圓圈輪廓;Caps Lock = 十字(precise,PS 慣例)。
// CSS cursor 圖有 128px 上限,大圈只能藏系統游標 + 自畫跟隨 div。
const capsLock = ref(false);
const cursorPos = ref<{ x: number; y: number } | null>(null); // container 相對座標

// [ ] 的階梯步進:小筆刷細調、大筆刷粗調(PS 體感;精確表無文件,自訂)
function bracketStep(size: number): number {
  if (size < 10) return 1;
  if (size < 100) return 5;
  if (size < 300) return 10;
  return 25;
}

// ---- 座標 ----
function toDoc(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = containerEl.value!.getBoundingClientRect();
  return screenToContentPx(e.clientX, e.clientY, rect, view);
}

// ---- 重繪 ----
// 視口解析度合成:顯示 canvas = 容器尺寸 × dpr,view transform 進 ctx
// (setTransform),pan/zoom/rotate = 重合成(0.3ms 級)。文字統一在合成
// 序列裡 drawElementImage:錨定的插在對應層前(interleave),浮動的畫在
// 最上——「浮動 vs 錨定」只差 z 序,清晰度一律向量銳利。

// rAF 對齊 + 髒標記:一幀多次變更(高輪詢率滑鼠、多個 watch)只合成一次
let redrawScheduled = false;
let redrawSuspended = false; // 匯出中 backing store 暫為 doc 尺寸,視口重繪停火
function scheduleRedraw(): void {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    redraw();
  });
}

// paint record 未就緒(節點剛掛上/剛改字)時等兩幀重試,合流防抖
let retryPending = false;
function retryRedraw(): void {
  if (retryPending) return;
  retryPending = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      retryPending = false;
      scheduleRedraw();
    }),
  );
}

/** engine 合成 hook:遇 text layer 節點就叫這個畫 label。z-order 由 tree
 * 位置決定,不再有 anchor / floating 兩種分類——text 節點在哪個 z 位就在
 * 那畫,現況全部在 root 頂端(C3 才會有樣式群組 folder 讓 text 進去)。 */
function drawTextNode(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  labelId: string,
): void {
  const d = doc.value;
  if (!d) return;
  if (labelId === hiddenNativeMoveId.value) return;
  const l = currentLabels.value.find((x) => x.id === labelId);
  if (!l || l.text === "") return;
  const el = textEls.get(labelId);
  if (!el) return;
  if (!drawLabelElement(ctx, el, l.x * d.width, l.y * d.height)) retryRedraw();
}

// 高倍 zoom 關閉平滑採樣(看得到像素格,PS 慣例);低倍平滑
const SMOOTH_OFF_ZOOM = 3;

/** 把 view transform(含 dpr)套上 ctx——顯示合成與蟻線共用同一個變換。 */
function applyViewTransform(
  c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): void {
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.translate(view.tx, view.ty);
  c.scale(view.scale, view.scale);
  c.rotate(view.rotate);
}

/**
 * 共用合成路徑:redraw()(視口顯示)與 onExport()(匯出)都經過這裡,
 * 保證兩者的像素結果一致。engine 的 compositeInto 遞迴 walk tree,遇 text
 * 節點就呼叫 drawTextNode——所有 label 都是 tree 節點,z-order 由 tree
 * 位置決定,沒有「錨定 vs 浮動」的分類。
 *
 * opts:
 * - applyTransform:讓 caller 決定要不要套 view transform / dpr;engine
 *   端保持只認識像素堆疊(見設計 tradeoff:LetterMode 側收斂 presentation
 *   關切,engine 保持 pure)。省略 = 不動 ctx transform(等同 identity)
 * - smoothing:PS 慣例——高倍 zoom 關 imageSmoothing;省略 = 不動
 * - background:destination-over 墊底色(匯出白底用);省略 = 保留透明
 */
function composite(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  opts: {
    applyTransform?: (c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;
    smoothing?: boolean;
    background?: string;
  } = {},
): void {
  const d = doc.value;
  if (!d) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  opts.applyTransform?.(ctx);
  if (opts.smoothing !== undefined) ctx.imageSmoothingEnabled = opts.smoothing;
  d.compositeInto(ctx, { drawText: drawTextNode });
  if (opts.background !== undefined) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, d.width, d.height);
    ctx.globalCompositeOperation = "source-over";
  }
}

function redraw(): void {
  // 隱藏中(翻譯 mode)display:none 拿不到 paint record,畫了必失敗
  // → retry 迴圈;切回 letter 時由 appMode watch / RO 補一次重繪
  if (appMode.value !== "letter") return;
  const d = doc.value;
  const cv = canvasEl.value;
  if (!d || !displayCtx || !cv || redrawSuspended) return;
  const c = displayCtx;
  perf.lastDraw = timeMs(() => {
    // viewport clear 是 LetterMode 專屬:canvas backing store 大於 doc 尺寸
    // (dpr × 容器尺寸),doc 外的舊像素得先清乾淨。matched pair 也是唯一
    // 需要 setTransform 到 identity 的地方——之後 composite() 內自己 reset
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    composite(c, {
      applyTransform: applyViewTransform,
      smoothing: view.scale < SMOOTH_OFF_ZOOM,
    });
    // 文件邊界(1 螢幕 px,取代舊 CSS box-shadow)——view transform 仍在
    c.lineWidth = 1 / view.scale;
    c.strokeStyle = "rgba(128,128,128,0.6)";
    c.strokeRect(0, 0, d.width, d.height);
  });
}

/** 重量容器 + 適應視窗(Esc 連按與底部列的「適應視窗」共用)。 */
function refit(): void {
  resizeCanvases();
  fitToView();
}

/** 量容器 + 對齊兩個視口 canvas 的 backing store(容器尺寸 × dpr)。 */
function resizeCanvases(): void {
  const el = containerEl.value;
  const cv = canvasEl.value;
  if (!el || !cv) return;
  containerSize.w = el.clientWidth;
  containerSize.h = el.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(el.clientWidth * dpr));
  const h = Math.max(1, Math.round(el.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const sc = selCanvasEl.value;
  if (sc && (sc.width !== w || sc.height !== h)) {
    sc.width = w;
    sc.height = h;
  }
  scheduleRedraw();
  drawAnts();
}

// ---- 載圖 ----
/**
 * 用一批已建立的 layers 建立新文件並掛上 canvas。
 * loadPage(專案模式) 走 manifest → 各層獨立 PNG 重建;
 * onPickFile(單檔模式) 只放單一底圖層。
 */
function buildDoc(width: number, height: number, layers: Layer[]): void {
  const d = new ShashokuDoc(width, height);
  for (const layer of layers) d.insertLayer(layer, d.layers.length);
  inpaintLayerId = null;
  const firstRaster = layers.find((l): l is RasterLayer => l.kind === "raster");
  activeLayerId.value = firstRaster?.id ?? null;

  doc.value = d;
  editor.history.clear(); // 換頁 = 新文件,舊 undo 閉包指向舊 doc,必清
  editor.setSelection(null);
  applyNormalize(); // 樣式群組 folders + text nodes 依當前 label/group 現況建
  perf.imageSize = `${d.width}×${d.height}`;

  // 顯示 canvas 是視口尺寸(mount 起固定),與文件尺寸脫鉤——大頁不再撐大 buffer
  resizeCanvases();
  // 自動 fit 走 viewFit 守門:換頁重 fit;同一頁(翻譯側已 fit 過、視角
  // 可能已被調過)繼承現有視角。單檔模式(無專案頁)一律 fit
  const pageKey = loadedPage.value;
  if ((pageKey === null || viewFit.page !== pageKey) && fitToView()) viewFit.page = pageKey;
  // raster:false —— 純載入,disk 狀態沒變,不該觸發 autosave 重寫 revision
  editor.changed({ raster: false });
}

/**
 * label ↔ tree 冪等同步器(store→doc 耦合的入口)。走 normalize() 純函式:
 * - 依 projectGroups 順序建/保留樣式群組 folder 在 root 頂
 * - label.groupId 對應的 text node 落進對應樣式群組 folder
 * - label.groupId=null 的 text node 落到 root 頂(或保留在用戶手動放的
 *   一般 group 內)
 * - orphan text / orphan 樣式群組 folder 清理
 *
 * 觸發點:buildDoc(載入頁)、watch([currentLabels, header])(add/delete/
 * updateLabelGroupId / addGroup / removeLastGroup 都由 header 深觀察涵蓋)。
 */
function applyNormalize(): void {
  const d = doc.value;
  if (!d) return;
  d.layers = normalize(
    d.layers,
    currentLabels.value.map((l) => ({ id: l.id, groupId: l.groupId })),
    projectStore.header.groups.map((g) => ({ id: g.id, name: g.name })),
    () => crypto.randomUUID(),
  );
}

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loadedPage.value = null; // 單檔模式:無專案頁,OCR/標籤投影不可用
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width;
  const h = bitmap.height;
  const base = rasterLayerFromBitmap("底圖", bitmap, w, h);
  base.locked = true;
  bitmap.close();
  buildDoc(w, h, [base]);
  editor.docPage.value = null;
  input.value = "";
}

// ---- 專案頁載入(專案本身由翻譯 mode 開啟,這裡只消費)----

/** 切頁重建文件。isStale:呼叫端的作廢判定——IPC/解碼完成順序不保證跟請求順序
 * 一致,讀檔解碼完回來先問一聲,已作廢就丟棄,不讓舊頁覆蓋新頁。
 *
 * 兩條路徑:
 * - 首次載入(manifest.layers 空):從 raws/<n> 建底圖(單層,locked)
 * - 已編輯過的頁(manifest.layers 有內容):從 pages/<n>/layers/*.png 逐層還原,
 *   同步保留 opacity/blendMode/visible/locked/alphaLocked。**一旦落地過,永遠
 *   從 layers/ 讀**——不再從 raws 兜底,避免其他層畫的東西憑空消失。
 */
async function loadPage(name: string, isStale: () => boolean = () => false): Promise<void> {
  const rawsDir = projectStore.rawsDir;
  const file = projectStore.fileByName(name);
  if (!rawsDir || !file || !file.pageDir) return;

  // damaged 頁:openProject 已偵測 manifest 損毀;拒絕載入,提示使用者手動處理。
  // 不建 doc 也不觸發 autosave(watch 已擋),避免用新 manifest 覆寫救援資料。
  if (file.badge === "damaged") {
    toast.error(`第 ${name} 頁的 manifest 損毀`, {
      description: `請檢查 pages/${name.replace(/\.[^.]+$/, "")}/ 內部檔案`,
    });
    return;
  }

  // 先讀 raws 拿 bitmap 尺寸(即使 manifest 有 layers 也要,因為需要 doc 的 w/h)
  const rawBytes = await window.api.readImage(rawsDir, name);
  const rawBitmap = await createImageBitmap(new Blob([rawBytes as unknown as BlobPart]));
  if (isStale()) {
    rawBitmap.close();
    return;
  }
  const w = rawBitmap.width;
  const h = rawBitmap.height;

  // 讀 manifest;解析失敗代表 openProject 之後 disk 端有變化(邊際 case),
  // 同樣拒絕載入而非靜默 fallback(避免覆寫救援資料)。
  let manifestLayers: import("@shared/page/types").LayerEntry[] = [];
  let pageOcrRaw: string | null = null;
  try {
    const pageData = await window.api.readPage(file.pageDir);
    if (isStale()) {
      rawBitmap.close();
      return;
    }
    manifestLayers = parseManifest(pageData.manifestRaw).layers;
    pageOcrRaw = pageData.ocrRaw;
  } catch (err) {
    rawBitmap.close();
    toast.error(`第 ${name} 頁的 manifest 讀取失敗`, {
      description: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // OCR 快取還原:關 app 前跑過 OCR,重開時直接用
  if (pageOcrRaw !== null && ocrState[name] !== "running") {
    try {
      const ocr = parseOcr(pageOcrRaw);
      ocrData[name] = ocr.blocks;
      ocrState[name] = "done";
    } catch {
      // ocr.json 損毀:忽略,下次跑 OCR 覆蓋
    }
  }

  loadedPage.value = name;

  if (manifestLayers.length === 0) {
    // 首次載入:單層底圖
    const base = rasterLayerFromBitmap("底圖", rawBitmap, w, h);
    base.locked = true;
    rawBitmap.close();
    buildDoc(w, h, [base]);
  } else {
    // 已編輯過:遞迴 walk manifest 還原完整 tree,text/group 節點的位置
    // 由用戶拖曳決定,是 SSOT——不能丟給 applyNormalize 重建
    rawBitmap.close();
    const layersDir = projectStore.layersDirOf(file.pageDir);
    const restoreEntry = async (
      entry: import("@shared/page/types").LayerEntry,
    ): Promise<Layer | null> => {
      if (entry.kind === "raster") {
        const layerBytes = await window.api.readImage(layersDir, entry.file);
        if (isStale()) return null;
        const lbm = await createImageBitmap(new Blob([layerBytes as unknown as BlobPart]));
        const layer = rasterLayerFromEntry(entry, lbm, w, h);
        lbm.close();
        return layer;
      }
      if (entry.kind === "text") {
        return {
          kind: "text",
          id: entry.id,
          name: entry.name,
          visible: entry.visible,
          locked: entry.locked,
          labelId: entry.labelId,
        };
      }
      const children: Layer[] = [];
      for (const child of entry.children) {
        const restored = await restoreEntry(child);
        if (restored === null) return null;
        children.push(restored);
      }
      return {
        kind: "group",
        id: entry.id,
        name: entry.name,
        visible: entry.visible,
        locked: entry.locked,
        children,
        ...(entry.styleBinding ? { styleBinding: entry.styleBinding } : {}),
      };
    };
    const restored: Layer[] = [];
    for (const entry of manifestLayers) {
      const layer = await restoreEntry(entry);
      if (layer === null) return;
      restored.push(layer);
    }
    buildDoc(w, h, restored);
  }
  editor.docPage.value = name; // 校對 mode 靠它判斷 doc 屬於哪一頁
}

/** 點頁列表 = 移動全域頁游標;載入由下面的 watch 統一處理(翻譯側換頁同路)。 */
function selectPage(name: string): void {
  editorStore.selectFile(name);
}

// 惰性重載:只在嵌字 mode 顯示中且頁游標指向未載入的頁時才建 doc,
// 翻譯側連續換頁不會拖著嵌字重建文件。
// 競態守門:watch 重新觸發(用戶又換頁/切 mode)先跑上一輪的 onCleanup
// ——舊輪立 stale 旗標自行作廢,快速連續換頁時慢的舊請求不再覆蓋新頁
watch(
  [appMode, currentPage],
  async ([m, page], _old, onCleanup) => {
    if (m !== "letter" || !page || page === loadedPage.value) return;
    let stale = false;
    onCleanup(() => (stale = true));
    // 換頁前先把舊頁的 pending raster 落盤,避免 doc 被換掉後 pending 引用失效
    await flushPendingRasterSave();
    await loadPage(page, () => stale);
  },
  { immediate: true },
);

// 統一 raster dirty hook:rasterDirtyTick 只在真正 mutate 到持久化狀態時 tick
// (塗抹、inpaint、圖層 CRUD、undo/redo、merge down、tone 填充)。載入頁走
// editor.changed({ raster: false }),不會經過這裡,避免打開一頁就 autosave 覆寫。
// onPointerUp 的手工 schedule 保留是防止 tick 沒 fire 的邊際場景;兩者互為
// safety net(autosave pending Map 會 dedupe 同頁重複排程)。
// damaged 頁禁 autosave:避免用新 manifest 覆蓋還可救援的 layers。
watch(rasterDirtyTick, () => {
  if (!loadedPage.value || !doc.value) return;
  const file = projectStore.fileByName(loadedPage.value);
  if (!file?.pageDir || file.badge === "damaged") return;
  scheduleRasterAutosave(file.pageDir, doc.value);
});

// ---- OCR(sidecar)----
async function ocrOne(name: string): Promise<void> {
  if (!projectStore.rawsDir) return;
  ocrState[name] = "running";
  try {
    const res = await window.api.ocrPage(projectStore.rawsDir, name);
    ocrData[name] = res.blocks;
    ocrState[name] = "done";
    // 落地 pages/<n>/ocr.json:關 app 後仍能還原,不必重跑
    const file = projectStore.fileByName(name);
    if (file?.pageDir) {
      await window.api.writePage(file.pageDir, {
        ocrRaw: serializeOcr({
          schemaVersion: 1,
          width: res.width,
          height: res.height,
          blocks: res.blocks,
        }),
      });
    }
  } catch (err) {
    ocrState[name] = "error";
    console.error("OCR failed:", name, err);
  }
}

async function ocrCurrent(): Promise<void> {
  if (loadedPage.value) await ocrOne(loadedPage.value);
}

/** 批次:整個專案逐頁跑(sidecar 端序列處理)。再按一次 = 停止。 */
async function ocrProject(): Promise<void> {
  if (batchRunning.value) {
    batchRunning.value = false;
    return;
  }
  batchRunning.value = true;
  for (const f of projectStore.files) {
    if (!batchRunning.value) break;
    if (ocrState[f.filename] === "done" || ocrState[f.filename] === "running") continue;
    await ocrOne(f.filename);
  }
  batchRunning.value = false;
}

// ---- 去字(inpaint)----
const inpaintBusy = ref(false);

/** 對指定框去字:sidecar 回 RGBA 補丁,貼進「去字」圖層(可切作用層擦回)。 */
async function runInpaint(blocks: OcrBlock[]): Promise<void> {
  const name = loadedPage.value; // 補丁貼進 doc 圖層,必須與 doc 同頁
  const d = doc.value;
  if (!name || !d || inpaintBusy.value) return;
  // 拆成 plain object:blocks 來自 reactive state,是 Proxy,IPC structured clone 不吃
  const targets = blocks.filter((b) => b.label !== "bubble").map((b) => ({ ...b }));
  if (targets.length === 0) return;
  inpaintBusy.value = true;
  try {
    const res = await window.api.inpaintBlocks(projectStore.rawsDir!, name, targets);
    // 等 sidecar 的幾秒裡可能已換頁:d 指向被丟棄的舊 doc,寫進去等於
    // 資料靜默遺失,而收尾的 undo 又會塞進「新頁」的 History 變死條目
    if (doc.value !== d) return;
    // 惰性取得/建立去字層:機器輸出有自己的層(可切作用層擦回),插在
    // 底圖正上方維持 z 語意。用戶從面板刪掉的話,下次去字重建
    let layer = inpaintLayerId !== null ? d.findRasterLayer(inpaintLayerId) : undefined;
    if (!layer) {
      layer = createRasterLayer("去字", d.width, d.height);
      d.insertLayer(layer, 1);
      inpaintLayerId = layer.id;
    }
    const patches: PixelPatch[] = [];
    for (const p of res.patches) {
      const rect = clampRect({ x: p.x, y: p.y, w: p.w, h: p.h }, d.width, d.height);
      const before = copyRect(layer.data, d.width, rect);
      await d.blitPngPatch(layer.id, { x: p.x, y: p.y, w: p.w, h: p.h }, p.png);
      patches.push({ rect, before, after: copyRect(layer.data, d.width, rect) });
    }
    // blitPngPatch 逐補丁解碼也有 await:再驗一次才敢動 History
    if (doc.value !== d) return;
    // 整批去字 = 一步 undo
    if (patches.length) pushPixelPatches(editor.ctx(), layer.id, patches, "去字");
    editor.changed();
  } catch (err) {
    console.error("inpaint failed:", err);
  } finally {
    inpaintBusy.value = false;
  }
}

// ---- 標籤寫回通道(SSOT = projectStore;undo 進嵌字 History)----

function makeLabel(xPercent: number, yPercent: number, text = ""): LabelItem {
  return {
    id: crypto.randomUUID(),
    x: clamp(xPercent, 0, 1),
    y: clamp(yPercent, 0, 1),
    groupId: editorStore.activeGroupId ?? projectStore.header.groups[0]?.id ?? null,
    text,
  };
}

function pushLabelAdd(page: string, label: LabelItem): void {
  let index: number | undefined;
  projectStore.addLabel(page, label);
  editor.history.push({
    label: "新增標籤",
    undo: () => {
      index = projectStore.deleteLabel(page, label.id);
    },
    redo: () => projectStore.addLabel(page, label, index),
  });
  editorStore.selectedLabelId = label.id;
}

function pushLabelDelete(page: string, labelId: string): void {
  const label = projectStore.fileByName(page)?.labels.find((l) => l.id === labelId);
  if (!label) return;
  let index = projectStore.deleteLabel(page, labelId);
  editor.history.push({
    label: "刪除標籤",
    undo: () => projectStore.addLabel(page, label, index),
    redo: () => {
      index = projectStore.deleteLabel(page, labelId);
    },
  });
  if (editorStore.selectedLabelId === labelId) editorStore.selectedLabelId = null;
}

/** 拖曳結束提交:位置已在拖曳中即時套用(lazy-do,同翻譯側 cmdMoveLabel)。 */
function pushLabelMove(
  page: string,
  labelId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  if (from.x === to.x && from.y === to.y) return;
  editor.history.push({
    label: "移動文字",
    undo: () => projectStore.moveLabel(page, labelId, from.x, from.y),
    redo: () => projectStore.moveLabel(page, labelId, to.x, to.y),
  });
}

/** OCR 框 → 翻譯標籤:落在框中心,譯文由人打(原文留在面板對照)。 */
function blockToLabel(b: OcrBlock): void {
  const d = doc.value;
  const page = loadedPage.value;
  if (!d || !page) return;
  pushLabelAdd(page, makeLabel((b.x + b.w / 2) / d.width, (b.y + b.h / 2) / d.height));
  tool.value = "text";
}

// ---- 選區蟻線:marching squares 產 outline path + setLineDash + lineDashOffset ----
// mask → outline paths 只在 selection 變動時算一次;每幀只更新 phase 一個數字。
// 座標手動算成 device pixel + Math.round + 0.5,identity transform 畫——避開
// canvas 2D 的 view scale 帶進次像素造成 anti-alias 模糊。
// 黑實線底 + 白虛線疊上,不管背景色都看得到(BitMappery / PS 慣例)。
let antsRaf = 0;
let antsPhase = 0;
let antsLast = 0;
let antsOutlines: Point[][] | null = null;

const ANTS_DASH_SIZE = 6; // device pixel 級 dash 長度
// outline 頂點總數過多(極端複雜選區)時只畫靜態,不動畫
const ANTS_STATIC_LIMIT = 50_000;

function stopAnts(): void {
  if (antsRaf) cancelAnimationFrame(antsRaf);
  antsRaf = 0;
}

function drawAnts(): void {
  const el = selCanvasEl.value;
  if (!el) return;
  const c = el.getContext("2d");
  if (!c) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, el.width, el.height);
  if (!antsOutlines || antsOutlines.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  // 建 Path2D:每個 doc 座標點 → device pixel + round + 0.5,確保 1px stroke 落在
  // 整數 device pixel 上(不被 canvas anti-alias 抹開)
  const path = new Path2D();
  for (const loop of antsOutlines) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const sx = Math.round((view.tx + p.x * view.scale) * dpr) + 0.5;
      const sy = Math.round((view.ty + p.y * view.scale) * dpr) + 0.5;
      if (i === 0) path.moveTo(sx, sy);
      else path.lineTo(sx, sy);
    }
    path.closePath();
  }

  c.lineWidth = 1;
  // 黑實線底
  c.strokeStyle = "#000";
  c.setLineDash([]);
  c.stroke(path);
  // 白虛線疊上,lineDashOffset 每幀改一個數字就是爬行動畫
  c.strokeStyle = "#fff";
  c.setLineDash([ANTS_DASH_SIZE, ANTS_DASH_SIZE]);
  c.lineDashOffset = -antsPhase;
  c.stroke(path);
}

function antsFrame(now: number): void {
  antsRaf = requestAnimationFrame(antsFrame);
  if (now - antsLast < 80) return; // ~12fps 的爬行就夠
  antsLast = now;
  // 每幀 offset 位移 1 device pixel;dash cycle 是 dash*2 = 12 px,滿一圈就 wrap
  antsPhase = (antsPhase + 1) % (ANTS_DASH_SIZE * 2);
  drawAnts();
}

function rebuildAnts(): void {
  stopAnts();
  antsOutlines = null;
  const sel = editor.selection.value;
  const b = editor.selectionBounds.value;
  const d = doc.value;
  if (sel && b && d) {
    antsOutlines = traceMaskOutlines(sel, d.width, d.height, b);
  }
  drawAnts();
  const totalPts = antsOutlines?.reduce((s, l) => s + l.length, 0) ?? 0;
  if (antsOutlines && totalPts > 0 && totalPts <= ANTS_STATIC_LIMIT) {
    antsRaf = requestAnimationFrame(antsFrame);
  }
}

watch(editor.selection, rebuildAnts);

// view 變更(wheel/pan/rotate/fit)= 重合成——CSS transform 已退役,
// 「移動視角」就是「用新變換再畫一次」(PS/Figma 的顯示架構)
watch(view, () => {
  scheduleRedraw();
  drawAnts();
});

// 切回 letter mode:隱藏期間積欠的重繪補上(等兩幀讓 paint record 復活)
watch(appMode, (m) => {
  if (m === "letter") {
    resizeCanvases();
    retryRedraw();
  }
});

// ---- 指標互動 ----
const painting = ref(false);
let lastPt = { x: 0, y: 0 };
let panLast = { x: 0, y: 0 };
let panning = false;
let strokeDirty: Rect = EMPTY_RECT;
// 筆劃級 undo:動筆前抄整層(暫時性,pointerup 只留包圍盒兩份就丟)
let strokeBefore: Uint8ClampedArray | null = null;
let strokeUnion: Rect = EMPTY_RECT;
let draggingLabelId: string | null = null;
let dragLabelFrom: { x: number; y: number } | null = null; // percent(SSOT 座標)
let dragLabelSource: LabelItem | null = null;
let dragLabelStart: { x: number; y: number } | null = null;
let dragLabelMoved = false;
let dragLabelCopy = false;
let dragLabelDuplicate: LabelItem | null = null;

function stampAt(x: number, y: number): void {
  const d = doc.value!;
  const layer = d.findRasterLayer(activeLayerId.value);
  if (!layer || layer.locked) return; // 鎖定守門在工具層,引擎保持純粹
  const r = stampBrush(
    layer,
    d.width,
    d.height,
    x,
    y,
    brush.size / 2,
    brush.hardness,
    hexToRgb(brush.color),
    tool.value === "erase" ? "erase" : "paint",
    layer.alphaLocked,
    editor.selection.value,
  );
  strokeDirty = unionRect(strokeDirty, r);
  strokeUnion = unionRect(strokeUnion, r);
}

function onPointerDown(e: PointerEvent): void {
  if (!doc.value) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  // R+drag:旋轉視角(繞視窗中心)
  if (rDown.value) {
    rotating.value = true;
    const rect = containerEl.value!.getBoundingClientRect();
    rotatePivot = { x: rect.width / 2, y: rect.height / 2 };
    rotateStartAngle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    );
    rotateStartTheta = view.rotate;
    return;
  }

  // Alt+右鍵拖曳 = 筆刷 HUD(水平調大小、垂直調硬度;Esc 取消)
  if (e.button === 2 && e.altKey && (tool.value === "brush" || tool.value === "erase")) {
    const rect = containerEl.value!.getBoundingClientRect();
    brushHud.value = {
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
      size0: brush.size,
      hardness0: brush.hardness,
    };
    return;
  }

  // pan:空白鍵、中鍵、或 hand 工具
  if (spaceDown.value || e.button === 1 || tool.value === "hand") {
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;

  const p = toDoc(e);

  if (tool.value === "brush" || tool.value === "erase") {
    const layer = doc.value.findRasterLayer(activeLayerId.value);
    if (!layer || layer.locked) return; // 鎖定層不起筆
    painting.value = true;
    strokeDirty = EMPTY_RECT;
    strokeUnion = EMPTY_RECT;
    strokeBefore = layer.data.slice(); // 動筆前抄整層(pointerup 縮成包圍盒)
    stampAt(p.x, p.y);
    lastPt = p;
    doc.value.syncLayer(activeLayerId.value, strokeDirty);
    scheduleRedraw();
  } else if (tool.value === "tone" || tool.value === "marquee") {
    painting.value = true;
    lastPt = p;
    toneRect.value = { x: p.x, y: p.y, w: 0, h: 0 };
  } else if (tool.value === "move") {
    // PS 的 Move tool:點物件 = 選取(+可拖移),點空白 = 取消選取,絕不創建
    const hit = hitLabel(e);
    if (hit) {
      editorStore.selectedLabelId = hit.id;
      draggingLabelId = hit.id;
      dragLabelFrom = { x: hit.x, y: hit.y };
      dragLabelSource = { ...hit };
      dragLabelStart = { x: e.clientX, y: e.clientY };
      dragLabelMoved = false;
      dragLabelCopy = e.altKey;
      dragLabelDuplicate = null;
    } else {
      editorStore.selectedLabelId = null;
    }
  } else if (tool.value === "text") {
    const page = loadedPage.value;
    if (!page) return; // 標籤活在工程檔:單檔模式沒有可寫的 SSOT
    const hit = hitLabel(e);
    if (hit) {
      editorStore.selectedLabelId = hit.id;
      draggingLabelId = hit.id;
      dragLabelFrom = { x: hit.x, y: hit.y };
      dragLabelSource = { ...hit };
      dragLabelStart = { x: e.clientX, y: e.clientY };
      dragLabelMoved = false;
      dragLabelCopy = e.altKey;
      dragLabelDuplicate = null;
    } else {
      const label = makeLabel(p.x / doc.value.width, p.y / doc.value.height);
      pushLabelAdd(page, label);
      draggingLabelId = label.id;
      dragLabelFrom = { x: label.x, y: label.y };
      dragLabelSource = null;
      dragLabelStart = { x: e.clientX, y: e.clientY };
      dragLabelMoved = false;
      dragLabelCopy = false;
      dragLabelDuplicate = null;
    }
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!doc.value) return;

  // 游標圈跟隨 + Caps Lock 狀態同步(在視窗外切換,移進來一動就修正)
  {
    const rect = containerEl.value!.getBoundingClientRect();
    cursorPos.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    capsLock.value = e.getModifierState("CapsLock");
  }

  if (rotating.value) {
    const rect = containerEl.value!.getBoundingClientRect();
    const ang = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    );
    let theta = rotateStartTheta + (ang - rotateStartAngle);
    if (e.shiftKey) theta = Math.round(theta / (Math.PI / 12)) * (Math.PI / 12); // 吸附 15°
    rotateTo(theta, rotatePivot.x, rotatePivot.y);
    return;
  }

  if (brushHud.value) {
    const rect = containerEl.value!.getBoundingClientRect();
    const dx = e.clientX - rect.left - brushHud.value.sx;
    const dy = e.clientY - rect.top - brushHud.value.sy;
    // 水平:指數映射(小筆刷微調細、大筆刷變化快);垂直:線性 ~200px 拖滿,上軟下硬
    brush.size = clamp(Math.round(brushHud.value.size0 * Math.exp(dx / 120)), 1, BRUSH_MAX);
    brush.hardness = clamp(
      Math.round((brushHud.value.hardness0 + dy / 200) * 100) / 100,
      0,
      1,
    );
    return;
  }

  if (panning) {
    panBy(e.clientX - panLast.x, e.clientY - panLast.y);
    panLast = { x: e.clientX, y: e.clientY };
    return;
  }
  const p = toDoc(e);

  if (painting.value && (tool.value === "brush" || tool.value === "erase")) {
    // 沿 lastPt→p 補間戳印,避免快速移動出現斷點。
    const dx = p.x - lastPt.x;
    const dy = p.y - lastPt.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, (brush.size / 2) * 0.25);
    const n = Math.floor(dist / step);
    const ms = timeMs(() => {
      for (let i = 1; i <= n; i++) {
        stampAt(lastPt.x + (dx * i) / n, lastPt.y + (dy * i) / n);
      }
      if (n === 0) stampAt(p.x, p.y);
    });
    perf.lastStamp = ms;
    lastPt = p;
    doc.value.syncLayer(activeLayerId.value, strokeDirty);
    strokeDirty = EMPTY_RECT;
    scheduleRedraw();
  } else if (painting.value && (tool.value === "tone" || tool.value === "marquee")) {
    toneRect.value = {
      x: Math.min(lastPt.x, p.x),
      y: Math.min(lastPt.y, p.y),
      w: Math.abs(p.x - lastPt.x),
      h: Math.abs(p.y - lastPt.y),
    };
  } else if (draggingLabelId && loadedPage.value) {
    if (
      !dragLabelMoved &&
      dragLabelStart &&
      Math.hypot(e.clientX - dragLabelStart.x, e.clientY - dragLabelStart.y) < 3
    ) return;
    dragLabelMoved = true;
    if (dragLabelCopy && !dragLabelDuplicate && dragLabelSource) {
      const duplicate: LabelItem = {
        ...dragLabelSource,
        id: crypto.randomUUID(),
      };
      projectStore.addLabel(loadedPage.value, duplicate);
      draggingLabelId = duplicate.id;
      dragLabelDuplicate = duplicate;
      editorStore.selectedLabelId = duplicate.id;
    }
    // 拖曳中即時寫回 SSOT(percent);overlay 由 watch 自動重畫,翻譯視圖同步跟動
    projectStore.moveLabel(
      loadedPage.value,
      draggingLabelId,
      clamp(p.x / doc.value.width, 0, 1),
      clamp(p.y / doc.value.height, 0, 1),
    );
  }
}

function onPointerUp(e: PointerEvent): void {
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  if (brushHud.value) {
    brushHud.value = null; // 放開右鍵 = 收下新值
    return;
  }
  if (rotating.value) {
    rotating.value = false;
    return;
  }
  if (panning) {
    panning = false;
    return;
  }
  if (painting.value && (tool.value === "brush" || tool.value === "erase")) {
    // 整筆劃 = 一步 undo:全層快照縮成包圍盒 before/after
    if (strokeBefore && strokeUnion.w > 0 && doc.value) {
      const beforePatch = copyRect(strokeBefore, doc.value.width, strokeUnion);
      pushPixelPatch(
        editor.ctx(),
        activeLayerId.value,
        strokeUnion,
        beforePatch,
        tool.value === "erase" ? "擦除" : "筆刷",
      );
    }
    strokeBefore = null;
    strokeUnion = EMPTY_RECT;
    editor.changed(); // 筆劃結束:刷新面板縮圖
  }
  if (painting.value && tool.value === "marquee" && toneRect.value) {
    const d = doc.value!;
    const r = clampRect(toneRect.value, d.width, d.height);
    // 點一下(近零面積)= 取消選區,PS 慣例
    if (r.w < 2 && r.h < 2) editor.setSelection(null);
    else editor.setSelection(rectMask(d.width, d.height, r));
    toneRect.value = null;
  }
  if (painting.value && tool.value === "tone" && toneRect.value) {
    const d = doc.value!;
    // 網點與筆刷同語義:畫在使用中圖層,鎖定守門(底圖鎖定時 no-op)
    const layer = d.findRasterLayer(activeLayerId.value);
    const r = clampRect(toneRect.value, d.width, d.height);
    if (layer && !layer.locked && r.w > 0 && r.h > 0) {
      const before = copyRect(layer.data, d.width, r);
      perf.lastStamp = timeMs(() => {
        fillScreentoneRect(
          layer,
          d.width,
          d.height,
          r,
          {
            pitch: tone.pitch,
            angle: tone.angle,
            density: tone.density,
            color: hexToRgb(tone.color),
          },
          editor.selection.value,
        );
      });
      d.syncLayer(layer.id, r);
      pushPixelPatch(editor.ctx(), layer.id, r, before, "網點填充");
    }
    toneRect.value = null;
    editor.changed();
  }
  if (draggingLabelId && loadedPage.value && dragLabelFrom && dragLabelMoved) {
    const l = currentLabels.value.find((ll) => ll.id === draggingLabelId);
    if (l) {
      if (dragLabelDuplicate) {
        const page = loadedPage.value;
        const duplicate = dragLabelDuplicate;
        let index: number | undefined;
        editor.history.push({
          label: "複製文字",
          undo: () => {
            index = projectStore.deleteLabel(page, duplicate.id);
          },
          redo: () => {
            projectStore.addLabel(page, duplicate, index);
          },
        });
      } else {
        pushLabelMove(loadedPage.value, draggingLabelId, dragLabelFrom, { x: l.x, y: l.y });
      }
    }
  }
  // Raster autosave:筆刷/擦除/網點結束後排程落地(只針對專案頁)。
  // painting.value 尚未 reset,tool 判斷確保只在有 raster 改動的路徑觸發。
  if (
    painting.value &&
    (tool.value === "brush" || tool.value === "erase" || tool.value === "tone") &&
    loadedPage.value &&
    doc.value
  ) {
    const file = projectStore.fileByName(loadedPage.value);
    if (file?.pageDir && file.badge !== "damaged") {
      scheduleRasterAutosave(file.pageDir, doc.value);
    }
  }

  painting.value = false;
  draggingLabelId = null;
  dragLabelFrom = null;
  dragLabelSource = null;
  dragLabelStart = null;
  dragLabelMoved = false;
  dragLabelCopy = false;
  dragLabelDuplicate = null;
}

interface ActiveNativeDrag {
  payload: LabelDragPayload;
  page: string;
  source: LabelItem;
  startDoc: { x: number; y: number };
  oldPos: { x: number; y: number };
  localCommitted: boolean;
}

let pendingNativeDrag: {
  labelId: string;
  page: string;
  startDoc: { x: number; y: number };
} | null = null;
let activeNativeDrag: ActiveNativeDrag | null = null;
const hiddenNativeMoveId = ref<string | null>(null);

function onNativeLabelPointerDown(label: LabelItem, e: PointerEvent): void {
  if (e.button !== 0 || spaceDown.value) return;
  if (tool.value !== "move" && tool.value !== "text" && !e.altKey) return;
  const page = loadedPage.value;
  if (!page) return;
  e.stopPropagation();
  editorStore.selectedLabelId = label.id;
  pendingNativeDrag = {
    labelId: label.id,
    page,
    startDoc: toDoc(e),
  };
}

function onNativeLabelDragStart(label: LabelItem, e: DragEvent): void {
  const page = loadedPage.value;
  if (
    !page ||
    !e.dataTransfer ||
    spaceDown.value ||
    (tool.value !== "move" && tool.value !== "text" && !e.altKey)
  ) {
    e.preventDefault();
    return;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const operation = e.altKey ? "copy" : "move";
  const payload: LabelDragPayload = {
    version: 2,
    kind: "label",
    source: "main",
    operation,
    token: crypto.randomUUID(),
    sourceId: label.id,
    label: {
      text: label.text,
      groupId: label.groupId,
      groupName: groupNameOfLabel(label) || null,
    },
    grabOffset: {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    },
  };
  const startDoc =
    pendingNativeDrag?.labelId === label.id && pendingNativeDrag.page === page
      ? pendingNativeDrag.startDoc
      : toDoc(e);
  pendingNativeDrag = null;
  const source = { ...label };
  activeNativeDrag = {
    payload,
    page,
    source,
    startDoc,
    oldPos: { x: label.x, y: label.y },
    localCommitted: false,
  };
  const preview = setLabelDragPreview(
    e.dataTransfer,
    label,
    effectiveStyleForLabel(label, projectStore.header),
    {
      scale: view.scale,
      rotation: view.rotate,
      sourceRect: rect,
      hotspot: payload.grabOffset,
      emptyDotColor: groupColorOfLabel(label),
    },
  );
  payload.grabOffset = preview.grabOffset;
  e.dataTransfer.clearData();
  e.dataTransfer.setData(LABEL_DRAG_TYPE, serializeLabelDrag(payload));
  e.dataTransfer.effectAllowed = operation;
  if (operation === "move") {
    hiddenNativeMoveId.value = label.id;
    scheduleRedraw();
  }
}

function commitNativeDuplicate(active: ActiveNativeDrag, duplicate: LabelItem): void {
  projectStore.addLabel(active.page, duplicate);
  let index: number | undefined;
  editor.history.push({
    label: "複製文字",
    undo: () => {
      index = projectStore.deleteLabel(active.page, duplicate.id);
    },
    redo: () => {
      projectStore.addLabel(active.page, duplicate, index);
    },
  });
}

function onNativeLabelDragEnd(e: DragEvent): void {
  const active = activeNativeDrag;
  activeNativeDrag = null;
  pendingNativeDrag = null;
  hiddenNativeMoveId.value = null;
  scheduleRedraw();
  if (!active || active.localCommitted) return;
  if (active.payload.operation === "move" && e.dataTransfer?.dropEffect === "move") {
    pushLabelDelete(active.page, active.payload.sourceId);
  }
}

function onLabelDragOver(e: DragEvent): void {
  if (
    !e.dataTransfer ||
    !Array.from(e.dataTransfer.types).includes(LABEL_DRAG_TYPE) ||
    !doc.value ||
    !loadedPage.value
  ) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
}

function onLabelDrop(e: DragEvent): void {
  const d = doc.value;
  const page = loadedPage.value;
  if (!d || !page || !e.dataTransfer) return;
  const payload = parseLabelDrag(e.dataTransfer.getData(LABEL_DRAG_TYPE));
  if (!payload) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = payload.operation;
  const active = activeNativeDrag;
  if (active?.payload.token === payload.token && active.page === page) {
    const p = toDoc(e);
    const x = clamp(active.oldPos.x + (p.x - active.startDoc.x) / d.width, 0, 1);
    const y = clamp(active.oldPos.y + (p.y - active.startDoc.y) / d.height, 0, 1);
    if (payload.operation === "copy") {
      const duplicate = { ...active.source, id: crypto.randomUUID(), x, y };
      commitNativeDuplicate(active, duplicate);
      editorStore.selectedLabelId = duplicate.id;
    } else {
      projectStore.moveLabel(page, payload.sourceId, x, y);
      pushLabelMove(page, payload.sourceId, active.oldPos, { x, y });
      editorStore.selectedLabelId = payload.sourceId;
    }
    active.localCommitted = true;
    return;
  }
  const p = toDoc(e);
  const x = clamp(p.x / d.width, 0, 1);
  const y = clamp(p.y / d.height, 0, 1);
  if (payload.source === "main" && payload.operation === "move") {
    const label = projectStore.fileByName(page)?.labels.find((item) => item.id === payload.sourceId);
    if (label) {
      const oldPos = { x: label.x, y: label.y };
      projectStore.moveLabel(page, label.id, x, y);
      pushLabelMove(page, label.id, oldPos, { x, y });
      editorStore.selectedLabelId = label.id;
      return;
    }
  }
  pushLabelAdd(page, {
    id: crypto.randomUUID(),
    x,
    y,
    groupId: resolveDropGroupId(
      payload,
      projectStore.header.groups,
      editorStore.activeGroupId ?? projectStore.header.groups[0]?.id ?? null,
    ),
    text: payload.label.text,
  });
}

// ---- 標籤投影:排版外包 Chromium(隱形節點住 canvas fallback),顯示由
// 合成序列 drawElementImage 統一畫(浮動=最上層、錨定=插層間),任意倍率
// 向量銳利。命中測試全幾何(中心 ± 排版尺寸)——節點不在畫布位置。 ----

const textEls = new Map<string, HTMLElement>();
function setTextEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) textEls.set(id, el);
  else textEls.delete(id);
}

/** 命中測試:全幾何(中心 ± 排版尺寸;空標籤用色點直徑)。節點躺在
 * canvas fallback 裡,DOM rect 不在畫布位置,量不得。 */
const DOT_SIZE = 18; // 空標籤色點直徑(doc px)

function hitLabel(e: PointerEvent): LabelItem | null {
  const d = doc.value;
  if (!d) return null;
  const pad = 6 / view.scale; // 螢幕 px 容差 → doc px
  const labels = currentLabels.value;
  const p = toDoc(e);
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    const el = textEls.get(l.id);
    const w = l.text === "" || !el ? DOT_SIZE : el.offsetWidth;
    const h = l.text === "" || !el ? DOT_SIZE : el.offsetHeight;
    if (
      Math.abs(p.x - l.x * d.width) <= w / 2 + pad &&
      Math.abs(p.y - l.y * d.height) <= h / 2 + pad
    ) {
      return l;
    }
  }
  return null;
}

// 標籤/樣式變更 → 同步 text node tree(add/delete)+ 重合成:立即排一次
// (位置變更用既有 paint record 就正確,拖曳手感不等幀),再等兩幀補一次
// (內容/樣式變更的新 record)。header deep watch 涵蓋 groups[].style 與
// defaultStyle 變動(per-label effective style 只在渲染時解析,不需獨立
// computed)。
watch(
  [currentLabels, () => projectStore.header],
  () => {
    applyNormalize();
    // 通知 UI 重新讀 tree(LayerPanel 的 uiTree computed 依 layersTick)。
    // raster:false 因為 tree 結構變不影響像素 buffer;raster autosave 走
    // scheduleRasterAutosave 那條線,不由這裡觸發。
    editor.changed({ raster: false });
    retryRedraw();
  },
  { deep: true, flush: "post" },
);

/** 選中標籤的虛線指示框(本體在合成裡,框畫在 doc 空間 overlay)。 */
function labelSelectionStyle(l: LabelItem): Record<string, string> {
  const d = doc.value;
  if (!d) return {}; // 頁切換空窗:v-show 不擋子節點渲染,style 仍會被求值
  const el = textEls.get(l.id);
  const w = (l.text === "" ? DOT_SIZE : el?.offsetWidth) || 24;
  const h = (l.text === "" ? DOT_SIZE : el?.offsetHeight) || 24;
  return {
    left: `${l.x * d.width - w / 2}px`,
    top: `${l.y * d.height - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    outline: `${2 / view.scale}px dashed rgba(80,160,255,0.9)`,
    outlineOffset: `${4 / view.scale}px`,
  };
}

function labelDragHitStyle(l: LabelItem): Record<string, string> {
  return {
    ...labelSelectionStyle(l),
    outline: "none",
    outlineOffset: "0",
  };
}

/** 空標籤的工作標記色點(doc 空間 overlay,不進合成、不進匯出)。 */
function dotStyle(l: LabelItem): Record<string, string> {
  const d = doc.value;
  if (!d) return {}; // 同上:頁切換空窗防禦
  return {
    left: `${l.x * d.width - DOT_SIZE / 2}px`,
    top: `${l.y * d.height - DOT_SIZE / 2}px`,
    width: `${DOT_SIZE}px`,
    height: `${DOT_SIZE}px`,
    background: groupColorOfLabel(l) ?? "rgb(128, 128, 128)",
  };
}

/** label 綁的 group name(未綁時空字串);drag payload 與 marker 顯示共用 */
function groupNameOfLabel(l: LabelItem): string {
  if (l.groupId === null) return "";
  return projectStore.header.groups.find((g) => g.id === l.groupId)?.name ?? "";
}
function groupColorOfLabel(l: LabelItem): string | undefined {
  if (l.groupId === null) return undefined;
  return projectStore.header.groups.find((g) => g.id === l.groupId)?.color;
}

// ---- 鍵盤 ----
function onKeyDown(e: KeyboardEvent): void {
  if (appMode.value !== "letter") return; // 兩個 mode 的 window 鍵盤 handler 各自 guard
  // Alt 是修飾鍵(Alt+滾輪縮放等),不讓它觸發任何瀏覽器/選單行為
  if (e.key === "Alt") e.preventDefault();
  capsLock.value = e.getModifierState("CapsLock");
  // PS 肌肉記憶快捷鍵(輸入框內不攔)
  if (!isTyping(e) && (e.ctrlKey || e.metaKey) && doc.value) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      editor.undo();
      e.preventDefault();
      return;
    }
    if ((k === "z" && e.shiftKey) || k === "y") {
      editor.redo();
      e.preventDefault();
      return;
    }
    if (k === "j") {
      const act = editor.activeLayer.value;
      if (act) {
        const copy = duplicateLayer(editor.ctx(), act.id);
        if (copy) activeLayerId.value = copy.id;
      }
      e.preventDefault();
      return;
    }
    if (k === "n" && e.shiftKey) {
      activeLayerId.value = addLayer(editor.ctx()).id;
      e.preventDefault();
      return;
    }
    if (k === "d") {
      editor.setSelection(null); // Ctrl+D 取消選區
      e.preventDefault();
      return;
    }
    if (k === "a") {
      editor.setSelection(fullMask(doc.value.width, doc.value.height)); // Ctrl+A 全選
      e.preventDefault();
      return;
    }
    if (k === "i" && e.shiftKey) {
      if (editor.selection.value) editor.setSelection(invertMask(editor.selection.value));
      e.preventDefault();
      return;
    }
  }
  // R 按住 = 旋轉視角模式(spring-loaded,同 Space pan)
  if (!isTyping(e) && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
    rDown.value = true;
    e.preventDefault();
    return;
  }
  // Esc:連按兩下 = 視角全重置(位置/縮放/旋轉);單按 + R 按住 = 只回正旋轉
  if (e.key === "Escape" && !isTyping(e)) {
    // 筆刷 HUD 拖曳中:取消 = 恢復起始值(不計入視角重置的連按窗)
    if (brushHud.value) {
      brush.size = brushHud.value.size0;
      brush.hardness = brushHud.value.hardness0;
      brushHud.value = null;
      return;
    }
    const now = performance.now();
    const isDouble = now - lastEscAt < 400;
    lastEscAt = isDouble ? 0 : now;
    if (isDouble && doc.value) {
      refit();
      return;
    }
    if (rDown.value && containerEl.value) {
      const rect = containerEl.value.getBoundingClientRect();
      rotateTo(0, rect.width / 2, rect.height / 2);
    }
    return;
  }
  // [ / ] 步進筆刷大小;Shift+[ / ] 硬度 ±25%(僅畫筆類工具,PS 慣例)
  if (
    !isTyping(e) &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.code === "BracketLeft" || e.code === "BracketRight") &&
    (tool.value === "brush" || tool.value === "erase")
  ) {
    const dir = e.code === "BracketLeft" ? -1 : 1;
    if (e.shiftKey) {
      brush.hardness = clamp(Math.round((brush.hardness + dir * 0.25) * 100) / 100, 0, 1);
    } else {
      // 遞減時按目標側取步進,10 按 [ 到 9 而不是 5
      const step = bracketStep(dir < 0 ? brush.size - 1 : brush.size);
      brush.size = clamp(brush.size + dir * step, 1, BRUSH_MAX);
    }
    return;
  }
  // 工具單鍵切換(PS 慣例)
  if (!isTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
    tool.value = TOOL_KEYS[e.key.toLowerCase()];
    return;
  }
  if (e.code === "Space" && !isTyping(e)) {
    spaceDown.value = true;
    e.preventDefault();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !isTyping(e)) {
    if (
      editorStore.selectedLabelId &&
      loadedPage.value &&
      (tool.value === "text" || tool.value === "move")
    ) {
      pushLabelDelete(loadedPage.value, editorStore.selectedLabelId);
      return;
    }
    // PS 的 Delete:清除作用層上選區內的像素(入史)
    const d = doc.value;
    const sel = editor.selection.value;
    const b = editor.selectionBounds.value;
    if (d && sel && b) {
      const layer = d.findRasterLayer(activeLayerId.value);
      if (layer && !layer.locked) {
        const before = copyRect(layer.data, d.width, b);
        clearSelected(layer, d.width, sel, b);
        d.syncLayer(layer.id, b);
        pushPixelPatch(editor.ctx(), layer.id, b, before, "清除選區內容");
      }
    }
  }
}
function onKeyUp(e: KeyboardEvent): void {
  // 不 guard mode:切走前按住的鍵(Space/R)要能歸零
  capsLock.value = e.getModifierState("CapsLock"); // keydown/keyup 都同步,吃掉平台時序差
  if (e.code === "Space") spaceDown.value = false;
  if (e.key.toLowerCase() === "r") rDown.value = false;
}
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === "TEXTAREA" || t.tagName === "INPUT";
}

// ---- 文字面板編輯 ----
// 譯文寫回選中標籤(入嵌字 History,同欄位連續輸入 mergeKey 合併);
// 樣式(字級/字體/顏色/方向)是 exportConfig 全域設定——per-label 樣式屬於
// 之後的「樣式群組」,這裡不入 undo(設定不進歷史,兩 mode 一致)。
function onLabelTextInput(e: Event): void {
  const page = loadedPage.value;
  const l = selectedLabel.value;
  const v = (e.target as HTMLTextAreaElement).value;
  if (!page || !l || l.text === v) return;
  const prev = l.text;
  const id = l.id;
  projectStore.updateLabelText(page, id, v);
  editor.history.push({
    label: "編輯譯文",
    mergeKey: `label-text:${id}`,
    undo: () => projectStore.updateLabelText(page, id, prev),
    redo: () => projectStore.updateLabelText(page, id, v),
  });
}

function onLabelGroupChange(e: Event): void {
  const page = loadedPage.value;
  const l = selectedLabel.value;
  const raw = (e.target as HTMLSelectElement).value;
  const v: string | null = raw === "" ? null : raw;
  if (!page || !l || l.groupId === v) return;
  const prev = l.groupId;
  const id = l.id;
  projectStore.updateLabelGroupId(page, id, v);
  editor.history.push({
    label: "變更分組",
    undo: () => projectStore.updateLabelGroupId(page, id, prev),
    redo: () => projectStore.updateLabelGroupId(page, id, v),
  });
}

function setExportStyle<K extends "font" | "fontSizePx" | "textColor" | "textDirection">(
  key: K,
  value: (typeof projectStore.exportConfig)[K],
): void {
  if (projectStore.exportConfig[key] === value) return;
  projectStore.exportConfig[key] = value;
  projectStore.markMetaDirty();
}

// ---- 匯出:同一條合成管線的無變換(doc 1:1)版本 ----
// 全部標籤常駐顯示畫布 fallback(不再需要 clone),所見即所得是同一份代碼
// 的結構保證。空標籤(色點)是 overlay 工作標記,本來就不在合成裡。
//
// 宿主仍是「顯示畫布本身」:paint record 只給視口內、實際被 paint 的元素,
// 而 drawElementImage 只能畫「自己 canvas」的子元素(ElementImage 進
// OffscreenCanvas 在 Chromium 150 拋 InvalidStateError,實測)。
// 所以匯出 = backing store 暫換 doc 尺寸(CSS 尺寸不動)→ 等兩幀(CSS↔grid
// 比例落定)→ identity 合成 → toBlob → 換回。
async function onExport(): Promise<void> {
  const d = doc.value;
  const cv = canvasEl.value;
  const c = displayCtx;
  if (!d || !cv || !c) return;
  redrawSuspended = true; // 排程中的視口重繪不可落在 doc 尺寸的 buffer 上
  try {
    cv.width = d.width;
    cv.height = d.height;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    composite(c, { background: "#ffffff" });
    const blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shashoku-export.png";
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    redrawSuspended = false;
    resizeCanvases(); // backing store 回視口尺寸 + 重繪
  }
}

// ---- 生命週期 ----
let ro: ResizeObserver | null = null;
onMounted(() => {
  editor.setRedraw(scheduleRedraw);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.api?.onOcrStatus((e) => {
    sidecarStatus.value =
      e.state === "starting"
        ? "OCR sidecar 啟動中…"
        : e.state === "loading"
          ? `載入中:${e.detail ?? ""}`
          : e.state === "ready"
            ? "OCR 就緒"
            : e.state === "stopped"
              ? "OCR sidecar 已停止"
              : `OCR 錯誤:${e.detail ?? ""}`;
  });
  ro = new ResizeObserver(() => {
    if (redrawSuspended) return; // 匯出中 backing store 是 doc 尺寸,別打斷
    resizeCanvases(); // 初始 fit 由 buildDoc 同步處理,RO 只管尺寸對齊
  });
  nextTick(() => {
    displayCtx = canvasEl.value?.getContext("2d") ?? null;
    if (containerEl.value) ro!.observe(containerEl.value);
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  ro?.disconnect();
  stopAnts();
});

// doc 空間 UI overlay(OCR 框/色點/選中框)的容器變換——與 ctx 的
// applyViewTransform 同一組參數,overlay 內只有輕量 DOM,無 canvas 無文字本體
const overlayTransform = computed(
  () => `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${view.rotate}rad)`,
);

// 筆刷 HUD 疊加(螢幕空間,錨定手勢起點):圈徑 = 文件 px × 縮放,
// 漸層起點 = 硬度(與引擎 falloff 同構:inner 內滿格、外緣線性衰減)
const hudCircleStyle = computed(() => {
  const g = brushHud.value;
  if (!g) return {};
  const d = brush.size * view.scale;
  const inner = Math.min(99.9, brush.hardness * 100);
  return {
    left: `${g.sx - d / 2}px`,
    top: `${g.sy - d / 2}px`,
    width: `${d}px`,
    height: `${d}px`,
    background: `radial-gradient(circle closest-side, rgba(226,59,59,0.4) ${inner}%, rgba(226,59,59,0) 100%)`,
    border: "1px solid rgba(226,59,59,0.9)",
  };
});

// 圈的螢幕直徑小於此值改用十字——小圈看不清,PS 同樣會自動退回 precise
const CURSOR_MIN_DIA = 6;
const brushCursorDia = computed(() => brush.size * view.scale);
const showBrushCursor = computed(
  () =>
    cursorPos.value !== null &&
    !capsLock.value &&
    (tool.value === "brush" || tool.value === "erase") &&
    brushCursorDia.value >= CURSOR_MIN_DIA &&
    !brushHud.value &&
    !rotating.value &&
    !rDown.value &&
    !spaceDown.value,
);
const brushCursorStyle = computed(() => {
  const p = cursorPos.value;
  if (!p) return {};
  const d = brushCursorDia.value;
  return {
    left: `${p.x - d / 2}px`,
    top: `${p.y - d / 2}px`,
    width: `${d}px`,
    height: `${d}px`,
    border: "1px solid rgba(0,0,0,0.9)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.6)", // 黑圈外加白暈,深淺底都看得見
  };
});

const cursorClass = computed(() => {
  // HUD 拖曳中游標保持可見:用戶全程追蹤得到游標,放開時「游標在這,筆刷自然在這」
  if (brushHud.value) return "cursor-default";
  if (rotating.value || rDown.value) return "cursor-grab";
  if (spaceDown.value || panning || tool.value === "hand") return "cursor-grab";
  if (tool.value === "move") return "cursor-default";
  if (tool.value === "text") return "cursor-text";
  if (showBrushCursor.value) return "cursor-none"; // 圓圈輪廓即游標
  return "cursor-crosshair";
});

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "move", label: "移動（選取物件）", key: "V" },
  { id: "hand", label: "手（平移）", key: "Space" },
  { id: "marquee", label: "選取（矩形）", key: "M" },
  { id: "brush", label: "筆刷", key: "B" },
  { id: "erase", label: "橡皮擦", key: "E" },
  { id: "tone", label: "網點", key: "G" },
  { id: "text", label: "文字", key: "T" },
];
const TOOL_KEYS: Record<string, Tool> = {
  v: "move",
  m: "marquee",
  b: "brush",
  e: "erase",
  g: "tone",
  t: "text",
  h: "hand",
};
</script>

<template>
  <div class="flex h-full w-full select-none text-sm">
    <!-- 左:工具列 -->
    <aside class="flex shrink-0 flex-col gap-1 border-r p-2" style="width: var(--layout-sidebar-w); border-color: var(--border); background: var(--card)">
      <div class="mb-1 px-1 text-xs font-semibold" style="color: var(--muted-foreground)">写植 Shashoku · POC</div>
      <button
        v-for="t in TOOLS"
        :key="t.id"
        class="flex items-center justify-between rounded px-2 py-1.5 text-left"
        :style="tool === t.id
          ? 'background: var(--primary); color: var(--primary-foreground)'
          : 'background: var(--accent)'"
        @click="tool = t.id"
      >
        <span>{{ t.label }}</span>
        <kbd class="text-[10px] opacity-60">{{ t.key }}</kbd>
      </button>

      <div class="mt-3 border-t pt-2" style="border-color: var(--border)">
        <label class="block cursor-pointer rounded px-2 py-1.5 text-center" style="background: var(--accent)">
          開啟圖片
          <input type="file" accept="image/*" class="hidden" @change="onPickFile" />
        </label>
        <button
          class="mt-1 w-full rounded px-2 py-1.5"
          style="background: var(--accent)"
          :disabled="!doc"
          @click="onExport"
        >
          匯出 PNG
        </button>
      </div>

      <!-- 專案 + OCR(專案由翻譯 mode 開啟,這裡消費同一份) -->
      <div class="mt-3 border-t pt-2" style="border-color: var(--border)">
        <p v-if="!projectStore.isOpen" class="px-1 text-[11px]" style="color: var(--muted-foreground)">
          到「翻譯」頁開啟或建立工程,頁列表與標籤會同步到這裡。
        </p>
        <template v-else>
          <button
            class="w-full rounded px-2 py-1.5"
            style="background: var(--accent)"
            :disabled="!loadedPage"
            @click="ocrCurrent"
          >
            偵測+OCR 本頁
          </button>
          <button
            class="mt-1 w-full rounded px-2 py-1.5"
            :style="batchRunning ? 'background: var(--primary); color: var(--primary-foreground)' : 'background: var(--accent)'"
            @click="ocrProject"
          >
            {{ batchRunning ? "停止批次" : "偵測整個專案" }}
          </button>
          <p v-if="sidecarStatus" class="mt-1 px-1 text-[10px]" style="color: var(--muted-foreground)">
            {{ sidecarStatus }}
          </p>
        </template>
      </div>

      <!-- 頁列表(全域頁游標,與翻譯 mode 同步) -->
      <ul v-if="projectStore.files.length" class="mt-1 min-h-0 flex-1 overflow-y-auto">
        <li v-for="f in projectStore.files" :key="f.filename">
          <button
            class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs"
            :style="f.filename === currentPage ? 'background: var(--primary); color: var(--primary-foreground)' : ''"
            @click="selectPage(f.filename)"
          >
            <span class="truncate">{{ f.filename }}</span>
            <span class="ml-1 shrink-0 text-[10px] opacity-80">
              {{
                ocrState[f.filename] === "running"
                  ? "⏳"
                  : ocrState[f.filename] === "error"
                    ? "✕"
                    : ocrData[f.filename]
                      ? ocrData[f.filename].length
                      : ""
              }}
            </span>
          </button>
        </li>
      </ul>

      <ModeSwitcher class="mt-auto" />
    </aside>

    <!-- 中:畫布 + 底部列 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <div class="relative min-h-0 flex-1 overflow-hidden" style="background: var(--muted)">
      <div
        ref="containerEl"
        class="absolute inset-0"
        :class="cursorClass"
        style="touch-action: none"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dragover="onLabelDragOver"
        @drop="onLabelDrop"
        @pointerleave="cursorPos = null"
        @contextmenu.prevent
      >
        <!-- 顯示畫布(螢幕空間,視口尺寸 × dpr):view transform 在 ctx 內,
             pan/zoom/rotate = 重合成。fallback content = 全部標籤節點
             (layoutsubtree:被排版、有 paint record、不顯示)——浮動與錨定
             同住,由合成序列統一 drawElementImage,任意倍率向量銳利 -->
        <canvas ref="canvasEl" class="absolute inset-0 h-full w-full" layoutsubtree>
          <div
            v-for="l in currentLabels"
            :key="l.id"
            :ref="(el) => setTextEl(l.id, el)"
            :style="cssForLabel(l)"
          >{{ l.text }}</div>
        </canvas>
        <!-- 選區蟻線(螢幕空間 canvas,ctx 內套同一 view transform) -->
        <canvas ref="selCanvasEl" class="pointer-events-none absolute inset-0 h-full w-full" />
        <!-- doc 空間 UI overlay(輕量 DOM,無 canvas 無文字本體):
             OCR 框/拖曳預覽/空標籤色點/選中框,座標直接用原圖 px -->
        <div
          v-show="doc"
          class="pointer-events-none absolute left-0 top-0 origin-top-left"
          :style="{ transform: overlayTransform }"
        >
          <div
            v-for="(b, i) in currentBlocks"
            :key="i"
            class="pointer-events-none absolute"
            :style="{
              left: b.x + 'px',
              top: b.y + 'px',
              width: b.w + 'px',
              height: b.h + 'px',
              border: `${2 / view.scale}px solid ${blockColor(b.label)}`,
              background: hoveredBlock === i ? blockColor(b.label) + '33' : 'transparent',
            }"
          >
            <span
              class="absolute left-0 top-0 px-0.5 font-mono leading-none"
              :style="{
                background: blockColor(b.label),
                color: '#fff',
                fontSize: `${Math.max(10, 14 / view.scale)}px`,
              }"
            >{{ i }}</span>
          </div>
          <!-- 網點/選取拖曳預覽框(doc 空間,跟著旋轉) -->
          <div
            v-if="toneRect"
            class="pointer-events-none absolute border-dashed"
            :style="{
              left: toneRect.x + 'px',
              top: toneRect.y + 'px',
              width: toneRect.w + 'px',
              height: toneRect.h + 'px',
              borderWidth: `${2 / view.scale}px`,
              borderColor: 'var(--primary)',
              background: 'rgba(201,100,66,0.12)',
            }"
          />
          <!-- 空標籤 = 工作標記色點(不進合成,也就不進匯出) -->
          <div
            v-for="l in currentLabels.filter((x) => x.text === '' && x.id !== hiddenNativeMoveId)"
            :key="`dot-${l.id}`"
            class="pointer-events-none absolute rounded-full"
            :style="dotStyle(l)"
          />
          <!-- 選中標籤的虛線指示框(文字本體在合成裡,框畫在 overlay) -->
          <div
            v-for="l in currentLabels.filter((x) => x.id === editorStore.selectedLabelId && x.id !== hiddenNativeMoveId)"
            :key="`sel-${l.id}`"
            class="pointer-events-none absolute"
            :style="labelSelectionStyle(l)"
          />
          <div
            v-for="l in currentLabels"
            :key="`drag-${l.id}`"
            class="absolute"
            :class="spaceDown ? 'pointer-events-none' : 'pointer-events-auto'"
            :style="labelDragHitStyle(l)"
            :draggable="!spaceDown"
            @pointerdown="onNativeLabelPointerDown(l, $event)"
            @dragstart.stop="onNativeLabelDragStart(l, $event)"
            @dragend="onNativeLabelDragEnd"
          />
        </div>
        <!-- 筆刷游標圈(實際落筆尺寸;Caps Lock 切回十字) -->
        <div
          v-if="showBrushCursor"
          class="pointer-events-none absolute rounded-full"
          :style="brushCursorStyle"
        />
        <!-- 筆刷 HUD(螢幕空間,錨定手勢起點,不隨視角旋轉) -->
        <template v-if="brushHud">
          <div class="pointer-events-none absolute rounded-full" :style="hudCircleStyle" />
          <div
            class="pointer-events-none absolute rounded px-2 py-1 text-xs"
            :style="{
              left: `${brushHud.sx + 16}px`,
              top: `${brushHud.sy - 36}px`,
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }"
          >
            直徑 {{ brush.size }}px · 硬度 {{ Math.round(brush.hardness * 100) }}%
          </div>
        </template>
        <div
          v-if="!doc"
          class="absolute inset-0 flex items-center justify-center text-center"
          style="color: var(--muted-foreground)"
        >
          左側「開啟圖片」載入一頁漫畫 →<br />筆刷塗改、網點填補、放文字、匯出。
        </div>
      </div>
      </div>
      <CanvasBottomBar :scale="view.scale" @zoom-by="zoomBy" @fit="refit" />
    </main>

    <!-- 右:參數 + 圖層 + 效能 -->
    <aside class="flex shrink-0 flex-col gap-3 overflow-y-auto border-l p-3" style="width: var(--layout-panel-w); border-color: var(--border); background: var(--card)">
      <section v-if="tool === 'tone'">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted-foreground)">網點（拖出矩形填入）</h3>
        <label class="block">格距 {{ tone.pitch }}px
          <input type="range" min="3" max="20" v-model.number="tone.pitch" class="w-full" />
        </label>
        <label class="block">角度 {{ tone.angle }}°
          <input type="range" min="0" max="90" v-model.number="tone.angle" class="w-full" />
        </label>
        <label class="block">密度 {{ tone.density.toFixed(2) }}
          <input type="range" min="0.05" max="0.95" step="0.01" v-model.number="tone.density" class="w-full" />
        </label>
        <label class="mt-1 flex items-center gap-2">顏色
          <input type="color" v-model="tone.color" />
        </label>
      </section>

      <section v-if="tool === 'text'">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted-foreground)">文字（標籤投影,與翻譯同步）</h3>
        <template v-if="selectedLabel">
          <textarea
            :value="selectedLabel.text"
            rows="3"
            class="w-full rounded p-1"
            style="background: var(--accent); color: var(--foreground)"
            @input="onLabelTextInput"
          />
          <label class="mt-1 block">分組
            <select
              class="w-full rounded px-1 py-0.5"
              style="background: var(--accent); color: var(--foreground)"
              :value="selectedLabel.groupId ?? ''"
              @change="onLabelGroupChange"
            >
              <option value="">未分組</option>
              <option v-for="(g, i) in projectStore.header.groups" :key="g.id" :value="g.id">
                {{ i + 1 }} · {{ g.name }}
              </option>
            </select>
          </label>
          <p class="mt-1 text-[11px]" style="color: var(--muted-foreground)">Delete 刪除選取標籤</p>
        </template>
        <p v-else-if="!loadedPage" class="text-[11px]" style="color: var(--muted-foreground)">
          文字即翻譯標籤,需先在「翻譯」頁開啟工程。
        </p>
        <p v-else class="text-[11px]" style="color: var(--muted-foreground)">點畫布空白處新增標籤;點文字選取/拖曳。</p>

        <!-- 全域文字樣式(exportConfig,兩個 mode 共用同一份渲染) -->
        <h3 class="mb-1 mt-3 text-xs font-semibold" style="color: var(--muted-foreground)">全域文字樣式</h3>
        <label class="block">字級 {{ projectStore.exportConfig.fontSizePx ?? 24 }}px
          <input
            type="range"
            min="8"
            max="120"
            :value="projectStore.exportConfig.fontSizePx ?? 24"
            class="w-full"
            @input="setExportStyle('fontSizePx', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <div class="mt-1 flex gap-1">
          <button
            class="flex-1 rounded px-1 py-1"
            :style="projectStore.exportConfig.textDirection !== 'vertical' ? 'background: var(--primary); color: var(--primary-foreground)' : 'background: var(--accent)'"
            @click="setExportStyle('textDirection', 'horizontal')"
          >橫排</button>
          <button
            class="flex-1 rounded px-1 py-1"
            :style="projectStore.exportConfig.textDirection === 'vertical' ? 'background: var(--primary); color: var(--primary-foreground)' : 'background: var(--accent)'"
            @click="setExportStyle('textDirection', 'vertical')"
          >直排</button>
        </div>
        <label class="mt-1 flex items-center gap-2">顏色
          <input
            type="color"
            :value="projectStore.exportConfig.textColor"
            @input="setExportStyle('textColor', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </section>

      <!-- OCR 原文 -->
      <section v-if="currentBlocks.length">
        <div class="mb-1 flex items-center justify-between">
          <h3 class="text-xs font-semibold" style="color: var(--muted-foreground)">
            OCR 原文（{{ currentBlocks.length }} 框）
          </h3>
          <button
            class="rounded px-1.5 py-0.5 text-[10px]"
            :style="inpaintBusy ? 'background: var(--primary); color: var(--primary-foreground)' : 'background: var(--accent)'"
            :disabled="inpaintBusy"
            @click="runInpaint(currentBlocks)"
          >
            {{ inpaintBusy ? "去字中…" : "去字全部" }}
          </button>
        </div>
        <ul class="max-h-72 overflow-y-auto text-xs">
          <li
            v-for="(b, i) in currentBlocks"
            :key="i"
            class="mb-1 rounded p-1.5"
            style="background: var(--accent)"
            @mouseenter="hoveredBlock = i"
            @mouseleave="hoveredBlock = null"
          >
            <div class="flex items-center gap-1">
              <span
                class="rounded px-1 font-mono text-[10px]"
                :style="{ background: blockColor(b.label), color: '#fff' }"
              >{{ i }}</span>
              <span class="text-[10px]" style="color: var(--muted-foreground)">
                {{ b.label }} {{ (b.score * 100).toFixed(0) }}%
              </span>
              <button
                v-if="b.text !== undefined"
                class="ml-auto rounded px-1 py-0.5 text-[10px]"
                style="background: var(--card)"
                :disabled="inpaintBusy"
                @click="runInpaint([b])"
              >
                去字
              </button>
              <button
                v-if="b.text !== undefined && loadedPage"
                class="rounded px-1 py-0.5 text-[10px]"
                style="background: var(--card)"
                @click="blockToLabel(b)"
              >
                +標籤
              </button>
            </div>
            <p v-if="b.text" class="mt-0.5 select-text" style="color: var(--foreground)">{{ b.text }}</p>
          </li>
        </ul>
      </section>

      <!-- 圖層面板(點列 = 作用層;拖曳排序;雙擊改名;Ctrl+click 縮圖 = 選區) -->
      <section v-if="doc">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted-foreground)">圖層</h3>
        <LayerPanel />
      </section>

      <!-- 效能 HUD -->
      <section class="mt-auto rounded p-2 text-[11px]" style="background: var(--accent)">
        <h3 class="mb-1 font-semibold" style="color: var(--muted-foreground)">效能（CPU/WASM 驗證）</h3>
        <div class="flex justify-between"><span>圖片</span><span>{{ perf.imageSize || "—" }}</span></div>
        <div class="flex justify-between">
          <span>像素寫入（筆刷/網點）</span><span>{{ perf.lastStamp.toFixed(2) }} ms</span>
        </div>
        <div class="flex justify-between">
          <span>drawImage 顯示合成</span><span>{{ perf.lastDraw.toFixed(2) }} ms</span>
        </div>
      </section>
    </aside>
  </div>
</template>
