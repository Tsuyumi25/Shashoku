<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ShashokuDoc } from "@/engine/document";
import { stampBrush } from "@/engine/brush";
import { fillScreentoneRect } from "@/engine/screentone";
import { benchmarkCpuComposite, timeMs } from "@/engine/perf";
import type { Rect, TextObject } from "@/engine/types";
import { unionRect, EMPTY_RECT } from "@/engine/geom";
import { clamp, screenToContentPx } from "@/lib/coords";
import { hexToRgb } from "@/lib/color";
import { useZoomPan } from "@/composables/useZoomPan";
import { useEditor } from "@/editor/useEditor";
import { addLayer, duplicateLayer } from "@/editor/actions";
import { addText, editText, moveText, removeText } from "@/editor/actions/text";
import { pushPixelPatch, pushPixelPatches, type PixelPatch } from "@/editor/pixel-history";
import { copyRect } from "@/engine/pixelPatch";
import { clampRect } from "@/engine/geom";
import {
  boundaryIndices,
  clearSelected,
  fullMask,
  invertMask,
  rectMask,
} from "@/engine/selection";
import LayerPanel from "@/components/LayerPanel.vue";
import type { OcrBlock } from "../shared/ipc";

type Tool = "hand" | "brush" | "erase" | "tone" | "text" | "marquee";

// ---- 狀態 ----
// doc / activeLayerId / undo 歷史活在 useEditor 單例,LayerPanel 共用同一份。
const editor = useEditor();
const { doc, activeLayerId } = editor;
const containerEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const selCanvasEl = ref<HTMLCanvasElement | null>(null); // 選區蟻線 overlay(doc 空間)
let displayCtx: CanvasRenderingContext2D | null = null;

let paintLayerId = "";
let toneLayerId = "";
let inpaintLayerId = "";

const tool = ref<Tool>("brush");
const brush = reactive({ size: 22, hardness: 0.85, color: "#e23b3b" });
const tone = reactive({ pitch: 6, angle: 45, density: 0.5, color: "#000000" });
const textStyle = reactive({
  fontSizePx: 32,
  fontFamily: "sans-serif",
  color: "#111111",
  direction: "horizontal" as "horizontal" | "vertical",
});

const selectedTextId = ref<string | null>(null);

// ---- 專案 + OCR 狀態 ----
const project = reactive<{ folder: string; images: string[] }>({ folder: "", images: [] });
const currentPage = ref<string | null>(null); // 專案模式下的當前頁檔名
const ocrData = reactive<Record<string, OcrBlock[]>>({});
const ocrState = reactive<Record<string, "running" | "done" | "error">>({});
const sidecarStatus = ref("");
const batchRunning = ref(false);
const hoveredBlock = ref<number | null>(null);

const currentBlocks = computed<OcrBlock[]>(() =>
  currentPage.value ? (ocrData[currentPage.value] ?? []) : []
);

function blockColor(label: OcrBlock["label"]): string {
  return label === "bubble" ? "#2e9e44" : label === "text_bubble" ? "#e05252" : "#b06fe0";
}

const containerSize = reactive({ w: 1, h: 1 });
const contentSize = computed(() => ({ w: doc.value?.width ?? 1, h: doc.value?.height ?? 1 }));
const { view, ready, fitToView, onWheel, panBy, rotateTo } = useZoomPan(
  containerSize,
  contentSize,
);

const perf = reactive({
  imageSize: "",
  cpuComposite: 0, // 純 CPU 全畫面合成中位數 ms
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

const selectedText = computed<TextObject | null>(
  () => doc.value?.texts.find((t) => t.id === selectedTextId.value) ?? null,
);

// ---- 座標 ----
function toDoc(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = containerEl.value!.getBoundingClientRect();
  return screenToContentPx(e.clientX, e.clientY, rect, view);
}

// ---- 重繪 ----
function redraw(): void {
  const d = doc.value;
  if (!d || !displayCtx) return;
  perf.lastDraw = timeMs(() => d.compositeInto(displayCtx!));
}

function measureContainer(): void {
  const el = containerEl.value;
  if (!el) return;
  containerSize.w = el.clientWidth;
  containerSize.h = el.clientHeight;
}

// ---- 載圖 ----
async function buildDoc(bitmap: ImageBitmap): Promise<void> {
  const d = new ShashokuDoc(bitmap.width, bitmap.height);
  const base = d.addLayerFromBitmap("底圖", bitmap);
  base.locked = true; // PS 慣例:背景層預設鎖定,防誤畫(面板可解鎖)
  inpaintLayerId = d.addBlankLayer("去字").id;
  paintLayerId = d.addBlankLayer("筆刷").id;
  toneLayerId = d.addBlankLayer("網點").id;
  activeLayerId.value = paintLayerId;
  bitmap.close();

  doc.value = d;
  editor.history.clear(); // 換頁 = 新文件,舊 undo 閉包指向舊 doc,必清
  editor.setSelection(null);
  selectedTextId.value = null;
  perf.imageSize = `${d.width}×${d.height}`;

  // canvas 尺寸 = 文件尺寸;縮放/平移由 CSS transform 負責。
  await nextTickCanvas();
  perf.cpuComposite = benchmarkCpuComposite(d.layers, d.width, d.height);
  measureContainer();
  fitToView();
  editor.changed(); // 面板列表/縮圖刷新 + 重繪
}

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  currentPage.value = null; // 單檔模式:無專案路徑,OCR 不可用
  await buildDoc(await createImageBitmap(file));
  input.value = "";
}

// ---- 專案(資料夾)----
async function openProject(): Promise<void> {
  const res = await window.api.openProjectFolder();
  if (!res) return;
  project.folder = res.folder;
  project.images = res.images;
  if (res.images.length > 0) await loadPage(res.images[0]);
}

/** 切頁重建文件。POC 限制:切頁不保留該頁的筆刷/網點/文字編輯。 */
async function loadPage(name: string): Promise<void> {
  const bytes = await window.api.readImage(project.folder, name);
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
  currentPage.value = name;
  await buildDoc(bitmap);
}

// ---- OCR(sidecar)----
async function ocrOne(name: string): Promise<void> {
  ocrState[name] = "running";
  try {
    const res = await window.api.ocrPage(project.folder, name);
    ocrData[name] = res.blocks;
    ocrState[name] = "done";
  } catch (err) {
    ocrState[name] = "error";
    console.error("OCR failed:", name, err);
  }
}

async function ocrCurrent(): Promise<void> {
  if (currentPage.value) await ocrOne(currentPage.value);
}

/** 批次:整個專案逐頁跑(sidecar 端序列處理)。再按一次 = 停止。 */
async function ocrProject(): Promise<void> {
  if (batchRunning.value) {
    batchRunning.value = false;
    return;
  }
  batchRunning.value = true;
  for (const name of project.images) {
    if (!batchRunning.value) break;
    if (ocrState[name] === "done" || ocrState[name] === "running") continue;
    await ocrOne(name);
  }
  batchRunning.value = false;
}

// ---- 去字(inpaint)----
const inpaintBusy = ref(false);

/** 對指定框去字:sidecar 回 RGBA 補丁,貼進「去字」圖層(可切作用層擦回)。 */
async function runInpaint(blocks: OcrBlock[]): Promise<void> {
  const name = currentPage.value;
  const d = doc.value;
  if (!name || !d || inpaintBusy.value) return;
  // 拆成 plain object:blocks 來自 reactive state,是 Proxy,IPC structured clone 不吃
  const targets = blocks.filter((b) => b.label !== "bubble").map((b) => ({ ...b }));
  if (targets.length === 0) return;
  inpaintBusy.value = true;
  try {
    const res = await window.api.inpaintBlocks(project.folder, name, targets);
    const layer = d.layers.find((l) => l.id === inpaintLayerId);
    const patches: PixelPatch[] = [];
    for (const p of res.patches) {
      const rect = clampRect({ x: p.x, y: p.y, w: p.w, h: p.h }, d.width, d.height);
      const before = layer ? copyRect(layer.data, d.width, rect) : null;
      await d.blitPngPatch(inpaintLayerId, { x: p.x, y: p.y, w: p.w, h: p.h }, p.png);
      if (layer && before) {
        patches.push({ rect, before, after: copyRect(layer.data, d.width, rect) });
      }
    }
    // 整批去字 = 一步 undo
    if (layer && patches.length) pushPixelPatches(editor.ctx(), inpaintLayerId, patches, "去字");
    editor.changed();
  } catch (err) {
    console.error("inpaint failed:", err);
  } finally {
    inpaintBusy.value = false;
  }
}

/** OCR 框 → 文字物件:落在框中心、預設直排,原文留在面板對照,譯文由人打。 */
function blockToText(b: OcrBlock): void {
  const d = doc.value;
  if (!d) return;
  const t: TextObject = {
    id: `text-${Date.now()}-${d.texts.length}`,
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
    text: "",
    fontSizePx: textStyle.fontSizePx,
    fontFamily: textStyle.fontFamily,
    color: textStyle.color,
    direction: "vertical",
  };
  addText(editor.ctx(), t);
  selectedTextId.value = t.id;
  tool.value = "text";
}

// 等 canvas 尺寸套用後再拿 context
function nextTickCanvas(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const c = canvasEl.value!;
      c.width = doc.value!.width;
      c.height = doc.value!.height;
      displayCtx = c.getContext("2d");
      const s = selCanvasEl.value;
      if (s) {
        s.width = doc.value!.width;
        s.height = doc.value!.height;
      }
      resolve();
    });
  });
}

// ---- 選區蟻線:邊界像素 + (x+y+phase) 棋盤紋 = 免路徑排序的爬行效果 ----
let antsRaf = 0;
let antsPhase = 0;
let antsLast = 0;
let antsBoundary: Uint32Array | null = null;
// 邊界像素過多(如 Ctrl+click 網點層 alpha,每顆點都是邊)時只畫靜態,不動畫
const ANTS_STATIC_LIMIT = 200_000;

function stopAnts(): void {
  if (antsRaf) cancelAnimationFrame(antsRaf);
  antsRaf = 0;
}

function drawAnts(): void {
  const el = selCanvasEl.value;
  const d = doc.value;
  if (!el) return;
  const c = el.getContext("2d");
  if (!c) return;
  c.clearRect(0, 0, el.width, el.height);
  if (!antsBoundary || !d) return;
  const w = d.width;
  for (let pass = 0; pass < 2; pass++) {
    c.fillStyle = pass === 0 ? "#000" : "#fff";
    for (let i = 0; i < antsBoundary.length; i++) {
      const idx = antsBoundary[i];
      const x = idx % w;
      const y = (idx - x) / w;
      if ((((x + y + antsPhase) >> 2) & 1) === pass) c.fillRect(x, y, 1, 1);
    }
  }
}

function antsFrame(now: number): void {
  antsRaf = requestAnimationFrame(antsFrame);
  if (now - antsLast < 80) return; // ~12fps 的爬行就夠
  antsLast = now;
  antsPhase = (antsPhase + 1) % 8;
  drawAnts();
}

function rebuildAnts(): void {
  stopAnts();
  antsBoundary = null;
  const sel = editor.selection.value;
  const b = editor.selectionBounds.value;
  const d = doc.value;
  if (sel && b && d) {
    antsBoundary = boundaryIndices(sel, d.width, d.height, b);
  }
  drawAnts();
  if (antsBoundary && antsBoundary.length <= ANTS_STATIC_LIMIT) {
    antsRaf = requestAnimationFrame(antsFrame);
  }
}

watch(editor.selection, rebuildAnts);

// ---- 指標互動 ----
const painting = ref(false);
let lastPt = { x: 0, y: 0 };
let panLast = { x: 0, y: 0 };
let panning = false;
let strokeDirty: Rect = EMPTY_RECT;
// 筆劃級 undo:動筆前抄整層(暫時性,pointerup 只留包圍盒兩份就丟)
let strokeBefore: Uint8ClampedArray | null = null;
let strokeUnion: Rect = EMPTY_RECT;
let draggingTextId: string | null = null;
let dragTextFrom = { x: 0, y: 0 };

function stampAt(x: number, y: number): void {
  const d = doc.value!;
  const layer = d.layers.find((l) => l.id === activeLayerId.value);
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
    const layer = doc.value.layers.find((l) => l.id === activeLayerId.value);
    if (!layer || layer.locked) return; // 鎖定層不起筆
    painting.value = true;
    strokeDirty = EMPTY_RECT;
    strokeUnion = EMPTY_RECT;
    strokeBefore = layer.data.slice(); // 動筆前抄整層(pointerup 縮成包圍盒)
    stampAt(p.x, p.y);
    lastPt = p;
    doc.value.syncLayer(activeLayerId.value, strokeDirty);
    redraw();
  } else if (tool.value === "tone" || tool.value === "marquee") {
    painting.value = true;
    lastPt = p;
    toneRect.value = { x: p.x, y: p.y, w: 0, h: 0 };
  } else if (tool.value === "text") {
    const hit = hitText(p.x, p.y);
    if (hit) {
      selectedTextId.value = hit.id;
      draggingTextId = hit.id;
      dragTextFrom = { x: hit.x, y: hit.y };
    } else {
      const t: TextObject = {
        id: `text-${Date.now()}`,
        x: p.x,
        y: p.y,
        text: "翻譯文字",
        fontSizePx: textStyle.fontSizePx,
        fontFamily: textStyle.fontFamily,
        color: textStyle.color,
        direction: textStyle.direction,
      };
      addText(editor.ctx(), t);
      selectedTextId.value = t.id;
      draggingTextId = t.id;
      dragTextFrom = { x: t.x, y: t.y };
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
    redraw();
  } else if (painting.value && (tool.value === "tone" || tool.value === "marquee")) {
    toneRect.value = {
      x: Math.min(lastPt.x, p.x),
      y: Math.min(lastPt.y, p.y),
      w: Math.abs(p.x - lastPt.x),
      h: Math.abs(p.y - lastPt.y),
    };
  } else if (draggingTextId) {
    const t = doc.value.texts.find((tt) => tt.id === draggingTextId);
    if (t) {
      t.x = p.x;
      t.y = p.y;
      redraw();
    }
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
    const layer = d.layers.find((l) => l.id === toneLayerId);
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
      d.syncLayer(toneLayerId, r);
      pushPixelPatch(editor.ctx(), toneLayerId, r, before, "網點填充");
    }
    toneRect.value = null;
    editor.changed();
  }
  if (draggingTextId) {
    moveText(editor.ctx(), draggingTextId, dragTextFrom); // 拖曳結束 = 一步
  }
  painting.value = false;
  draggingTextId = null;
}

function hitText(x: number, y: number): TextObject | null {
  const d = doc.value;
  if (!d) return null;
  for (let i = d.texts.length - 1; i >= 0; i--) {
    const t = d.texts[i];
    const lines = t.text.split("\n");
    const half = t.fontSizePx;
    const wSpan = t.direction === "horizontal" ? maxLineLen(lines) * t.fontSizePx * 0.6 : lines.length * t.fontSizePx;
    const hSpan = t.direction === "horizontal" ? lines.length * t.fontSizePx : maxLineLen(lines) * t.fontSizePx;
    if (Math.abs(x - t.x) <= wSpan / 2 + half && Math.abs(y - t.y) <= hSpan / 2 + half) return t;
  }
  return null;
}
function maxLineLen(lines: string[]): number {
  return lines.reduce((m, l) => Math.max(m, Array.from(l).length), 1);
}

// ---- 鍵盤 ----
function onKeyDown(e: KeyboardEvent): void {
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
      measureContainer();
      fitToView();
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
    if (selectedTextId.value) {
      removeText(editor.ctx(), selectedTextId.value);
      selectedTextId.value = null;
      return;
    }
    // PS 的 Delete:清除作用層上選區內的像素(入史)
    const d = doc.value;
    const sel = editor.selection.value;
    const b = editor.selectionBounds.value;
    if (d && sel && b) {
      const layer = d.layers.find((l) => l.id === activeLayerId.value);
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
  capsLock.value = e.getModifierState("CapsLock"); // keydown/keyup 都同步,吃掉平台時序差
  if (e.code === "Space") spaceDown.value = false;
  if (e.key.toLowerCase() === "r") rDown.value = false;
}
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === "TEXTAREA" || t.tagName === "INPUT";
}

// ---- 文字面板編輯(全部走 editText 入史;同欄位連續輸入自動合併) ----
function editSelected<K extends "text" | "fontSizePx" | "fontFamily" | "color" | "direction">(
  key: K,
  value: TextObject[K],
): void {
  const t = selectedText.value;
  if (!t || t[key] === value) return;
  const prev = { [key]: t[key] } as Partial<Pick<TextObject, K>>;
  t[key] = value;
  editText(editor.ctx(), t.id, { [key]: value } as Partial<Pick<TextObject, K>>, prev);
  redraw();
}

function onTextInput(e: Event): void {
  editSelected("text", (e.target as HTMLTextAreaElement).value);
}
function onFontSizeInput(e: Event): void {
  editSelected("fontSizePx", Number((e.target as HTMLInputElement).value));
}
function onColorInput(e: Event): void {
  editSelected("color", (e.target as HTMLInputElement).value);
}
function setDirection(d: "horizontal" | "vertical"): void {
  editSelected("direction", d);
}

// ---- 匯出 ----
async function onExport(): Promise<void> {
  const d = doc.value;
  if (!d) return;
  const blob = await d.exportPng();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "shashoku-export.png";
  a.click();
  URL.revokeObjectURL(url);
}

// ---- 生命週期 ----
let ro: ResizeObserver | null = null;
onMounted(() => {
  editor.setRedraw(redraw);
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
    measureContainer();
    if (doc.value && !ready.value) fitToView();
  });
  nextTick(() => containerEl.value && ro!.observe(containerEl.value));
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  ro?.disconnect();
  stopAnts();
});

const canvasTransform = computed(
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
  if (tool.value === "text") return "cursor-text";
  if (showBrushCursor.value) return "cursor-none"; // 圓圈輪廓即游標
  return "cursor-crosshair";
});

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "hand", label: "手（平移）", key: "Space" },
  { id: "marquee", label: "選取（矩形）", key: "M" },
  { id: "brush", label: "筆刷", key: "B" },
  { id: "erase", label: "橡皮擦", key: "E" },
  { id: "tone", label: "網點", key: "G" },
  { id: "text", label: "文字", key: "T" },
];
const TOOL_KEYS: Record<string, Tool> = {
  m: "marquee",
  b: "brush",
  e: "erase",
  g: "tone",
  t: "text",
  h: "hand",
};
</script>

<template>
  <div class="flex h-full w-full text-sm">
    <!-- 左:工具列 -->
    <aside class="flex w-44 flex-col gap-1 border-r p-2" style="border-color: var(--border); background: var(--panel)">
      <div class="mb-1 px-1 text-xs font-semibold" style="color: var(--muted)">写植 Shashoku · POC</div>
      <button
        v-for="t in TOOLS"
        :key="t.id"
        class="flex items-center justify-between rounded px-2 py-1.5 text-left"
        :style="tool === t.id
          ? 'background: var(--accent); color: #fff'
          : 'background: var(--panel-2)'"
        @click="tool = t.id"
      >
        <span>{{ t.label }}</span>
        <kbd class="text-[10px] opacity-60">{{ t.key }}</kbd>
      </button>

      <div class="mt-3 border-t pt-2" style="border-color: var(--border)">
        <label class="block cursor-pointer rounded px-2 py-1.5 text-center" style="background: var(--panel-2)">
          開啟圖片
          <input type="file" accept="image/*" class="hidden" @change="onPickFile" />
        </label>
        <button
          class="mt-1 w-full rounded px-2 py-1.5"
          style="background: var(--panel-2)"
          :disabled="!doc"
          @click="onExport"
        >
          匯出 PNG
        </button>
      </div>

      <!-- 專案 + OCR -->
      <div class="mt-3 border-t pt-2" style="border-color: var(--border)">
        <button class="w-full rounded px-2 py-1.5" style="background: var(--panel-2)" @click="openProject">
          開啟資料夾（專案）
        </button>
        <template v-if="project.images.length">
          <button
            class="mt-1 w-full rounded px-2 py-1.5"
            style="background: var(--panel-2)"
            :disabled="!currentPage"
            @click="ocrCurrent"
          >
            偵測+OCR 本頁
          </button>
          <button
            class="mt-1 w-full rounded px-2 py-1.5"
            :style="batchRunning ? 'background: var(--accent); color: #fff' : 'background: var(--panel-2)'"
            @click="ocrProject"
          >
            {{ batchRunning ? "停止批次" : "偵測整個專案" }}
          </button>
          <p v-if="sidecarStatus" class="mt-1 px-1 text-[10px]" style="color: var(--muted)">
            {{ sidecarStatus }}
          </p>
        </template>
      </div>

      <!-- 頁列表 -->
      <ul v-if="project.images.length" class="mt-1 min-h-0 flex-1 overflow-y-auto">
        <li v-for="name in project.images" :key="name">
          <button
            class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs"
            :style="name === currentPage ? 'background: var(--accent); color: #fff' : ''"
            @click="loadPage(name)"
          >
            <span class="truncate">{{ name }}</span>
            <span class="ml-1 shrink-0 text-[10px] opacity-80">
              {{
                ocrState[name] === "running"
                  ? "⏳"
                  : ocrState[name] === "error"
                    ? "✕"
                    : ocrData[name]
                      ? ocrData[name].length
                      : ""
              }}
            </span>
          </button>
        </li>
      </ul>
    </aside>

    <!-- 中:畫布 -->
    <main class="relative flex-1 overflow-hidden" style="background: #141412">
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
        @pointerleave="cursorPos = null"
        @contextmenu.prevent
      >
        <!-- 文件空間:canvas 與 OCR 框同住一個被 transform 的容器,框直接用原圖 px -->
        <div
          v-show="doc"
          class="absolute left-0 top-0 origin-top-left"
          :style="{ transform: canvasTransform }"
        >
          <canvas
            ref="canvasEl"
            class="block"
            style="image-rendering: pixelated; box-shadow: 0 0 0 1px var(--border)"
          />
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
              borderColor: 'var(--accent)',
              background: 'rgba(201,100,66,0.12)',
            }"
          />
          <!-- 選區蟻線(doc 空間,最上層) -->
          <canvas ref="selCanvasEl" class="pointer-events-none absolute left-0 top-0" />
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
              background: 'var(--panel)',
              border: '1px solid var(--border)',
            }"
          >
            直徑 {{ brush.size }}px · 硬度 {{ Math.round(brush.hardness * 100) }}%
          </div>
        </template>
        <div
          v-if="!doc"
          class="absolute inset-0 flex items-center justify-center text-center"
          style="color: var(--muted)"
        >
          左側「開啟圖片」載入一頁漫畫 →<br />筆刷塗改、網點填補、放文字、匯出。
        </div>
      </div>
    </main>

    <!-- 右:參數 + 圖層 + 效能 -->
    <aside class="flex w-64 flex-col gap-3 overflow-y-auto border-l p-3" style="border-color: var(--border); background: var(--panel)">
      <section v-if="tool === 'tone'">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted)">網點（拖出矩形填入）</h3>
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
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted)">文字（點畫布新增／選取）</h3>
        <template v-if="selectedText">
          <textarea
            :value="selectedText.text"
            rows="3"
            class="w-full rounded p-1"
            style="background: var(--panel-2); color: var(--fg)"
            @input="onTextInput"
          />
          <label class="block mt-1">字級 {{ selectedText.fontSizePx }}px
            <input
              type="range"
              min="8"
              max="120"
              :value="selectedText.fontSizePx"
              class="w-full"
              @input="onFontSizeInput"
            />
          </label>
          <div class="mt-1 flex gap-1">
            <button
              class="flex-1 rounded px-1 py-1"
              :style="selectedText.direction === 'horizontal' ? 'background: var(--accent); color:#fff' : 'background: var(--panel-2)'"
              @click="setDirection('horizontal')"
            >橫排</button>
            <button
              class="flex-1 rounded px-1 py-1"
              :style="selectedText.direction === 'vertical' ? 'background: var(--accent); color:#fff' : 'background: var(--panel-2)'"
              @click="setDirection('vertical')"
            >直排</button>
          </div>
          <label class="mt-1 flex items-center gap-2">顏色
            <input type="color" :value="selectedText.color" @input="onColorInput" />
          </label>
          <p class="mt-1 text-[11px]" style="color: var(--muted)">Delete 刪除選取文字</p>
        </template>
        <p v-else class="text-[11px]" style="color: var(--muted)">點畫布空白處新增文字物件。</p>
      </section>

      <!-- OCR 原文 -->
      <section v-if="currentBlocks.length">
        <div class="mb-1 flex items-center justify-between">
          <h3 class="text-xs font-semibold" style="color: var(--muted)">
            OCR 原文（{{ currentBlocks.length }} 框）
          </h3>
          <button
            class="rounded px-1.5 py-0.5 text-[10px]"
            :style="inpaintBusy ? 'background: var(--accent); color: #fff' : 'background: var(--panel-2)'"
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
            style="background: var(--panel-2)"
            @mouseenter="hoveredBlock = i"
            @mouseleave="hoveredBlock = null"
          >
            <div class="flex items-center gap-1">
              <span
                class="rounded px-1 font-mono text-[10px]"
                :style="{ background: blockColor(b.label), color: '#fff' }"
              >{{ i }}</span>
              <span class="text-[10px]" style="color: var(--muted)">
                {{ b.label }} {{ (b.score * 100).toFixed(0) }}%
              </span>
              <button
                v-if="b.text !== undefined"
                class="ml-auto rounded px-1 py-0.5 text-[10px]"
                style="background: var(--panel)"
                :disabled="inpaintBusy"
                @click="runInpaint([b])"
              >
                去字
              </button>
              <button
                v-if="b.text !== undefined"
                class="rounded px-1 py-0.5 text-[10px]"
                style="background: var(--panel)"
                @click="blockToText(b)"
              >
                +文字
              </button>
            </div>
            <p v-if="b.text" class="mt-0.5 select-text" style="color: var(--fg)">{{ b.text }}</p>
          </li>
        </ul>
      </section>

      <!-- 圖層面板(點列 = 作用層;拖曳排序;雙擊改名;Ctrl+click 縮圖 = 選區) -->
      <section v-if="doc">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted)">圖層</h3>
        <LayerPanel />
      </section>

      <!-- 效能 HUD -->
      <section class="mt-auto rounded p-2 text-[11px]" style="background: var(--panel-2)">
        <h3 class="mb-1 font-semibold" style="color: var(--muted)">效能（CPU/WASM 驗證）</h3>
        <div class="flex justify-between"><span>圖片</span><span>{{ perf.imageSize || "—" }}</span></div>
        <div class="flex justify-between">
          <span>純 CPU 全畫面合成</span><span>{{ perf.cpuComposite.toFixed(1) }} ms</span>
        </div>
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
