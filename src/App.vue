<script setup lang="ts">
import { computed, reactive, ref, shallowRef, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ShashokuDoc } from "@/engine/document";
import { stampBrush } from "@/engine/brush";
import { fillScreentoneRect } from "@/engine/screentone";
import { benchmarkCpuComposite, timeMs } from "@/engine/perf";
import type { RasterLayer, Rect, TextObject } from "@/engine/types";
import { unionRect, EMPTY_RECT } from "@/engine/geom";
import { screenToContentPx } from "@/lib/coords";
import { hexToRgb } from "@/lib/color";
import { useZoomPan } from "@/composables/useZoomPan";

type Tool = "hand" | "brush" | "erase" | "tone" | "text";

// ---- 狀態 ----
const doc = shallowRef<ShashokuDoc | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
let displayCtx: CanvasRenderingContext2D | null = null;

let paintLayerId = "";
let toneLayerId = "";

const tool = ref<Tool>("brush");
const brush = reactive({ size: 22, hardness: 0.85, color: "#e23b3b" });
const tone = reactive({ pitch: 6, angle: 45, density: 0.5, color: "#000000" });
const textStyle = reactive({
  fontSizePx: 32,
  fontFamily: "sans-serif",
  color: "#111111",
  direction: "horizontal" as "horizontal" | "vertical",
});

const layerList = ref<RasterLayer[]>([]);
const selectedTextId = ref<string | null>(null);
const redrawKey = ref(0); // bump 觸發 template 重新映射(圖層可見性等)

const containerSize = reactive({ w: 1, h: 1 });
const contentSize = computed(() => ({ w: doc.value?.width ?? 1, h: doc.value?.height ?? 1 }));
const { view, ready, fitToView, onWheel, panBy } = useZoomPan(containerSize, contentSize);

const perf = reactive({
  imageSize: "",
  cpuComposite: 0, // 純 CPU 全畫面合成中位數 ms
  lastStamp: 0, // 上一次筆刷/網點寫 buffer 的 ms
  lastDraw: 0, // 上一次 drawImage 顯示合成 ms
});

const spaceDown = ref(false);
const toneRect = ref<Rect | null>(null); // 網點拖曳中的預覽(doc 座標)

const selectedText = computed<TextObject | null>(
  () => doc.value?.texts.find((t) => t.id === selectedTextId.value) ?? null,
);

// ---- 座標 ----
function toDoc(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = containerEl.value!.getBoundingClientRect();
  return screenToContentPx(e.clientX, e.clientY, rect, view);
}
function toScreen(x: number, y: number): { x: number; y: number } {
  return { x: view.tx + x * view.scale, y: view.ty + y * view.scale };
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
async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const d = new ShashokuDoc(bitmap.width, bitmap.height);
  d.addLayerFromBitmap("底圖", bitmap);
  paintLayerId = d.addBlankLayer("筆刷").id;
  toneLayerId = d.addBlankLayer("網點").id;
  bitmap.close();

  doc.value = d;
  layerList.value = d.layers;
  selectedTextId.value = null;
  perf.imageSize = `${d.width}×${d.height}`;

  // canvas 尺寸 = 文件尺寸;縮放/平移由 CSS transform 負責。
  await nextTickCanvas();
  perf.cpuComposite = benchmarkCpuComposite(d.layers, d.width, d.height);
  measureContainer();
  fitToView();
  redraw();
  input.value = "";
}

// 等 canvas 尺寸套用後再拿 context
function nextTickCanvas(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const c = canvasEl.value!;
      c.width = doc.value!.width;
      c.height = doc.value!.height;
      displayCtx = c.getContext("2d");
      resolve();
    });
  });
}

// ---- 指標互動 ----
const painting = ref(false);
let lastPt = { x: 0, y: 0 };
let panLast = { x: 0, y: 0 };
let panning = false;
let strokeDirty: Rect = EMPTY_RECT;
let draggingTextId: string | null = null;

function stampAt(x: number, y: number): void {
  const d = doc.value!;
  const layer = d.layers.find((l) => l.id === paintLayerId)!;
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
  );
  strokeDirty = unionRect(strokeDirty, r);
}

function onPointerDown(e: PointerEvent): void {
  if (!doc.value) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  // pan:空白鍵、中鍵、或 hand 工具
  if (spaceDown.value || e.button === 1 || tool.value === "hand") {
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;

  const p = toDoc(e);

  if (tool.value === "brush" || tool.value === "erase") {
    painting.value = true;
    strokeDirty = EMPTY_RECT;
    stampAt(p.x, p.y);
    lastPt = p;
    doc.value.syncLayer(paintLayerId, strokeDirty);
    redraw();
  } else if (tool.value === "tone") {
    painting.value = true;
    lastPt = p;
    toneRect.value = { x: p.x, y: p.y, w: 0, h: 0 };
  } else if (tool.value === "text") {
    const hit = hitText(p.x, p.y);
    if (hit) {
      selectedTextId.value = hit.id;
      draggingTextId = hit.id;
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
      doc.value.texts.push(t);
      selectedTextId.value = t.id;
      draggingTextId = t.id;
      redraw();
    }
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!doc.value) return;

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
    doc.value.syncLayer(paintLayerId, strokeDirty);
    strokeDirty = EMPTY_RECT;
    redraw();
  } else if (painting.value && tool.value === "tone") {
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
  if (panning) {
    panning = false;
    return;
  }
  if (painting.value && tool.value === "tone" && toneRect.value) {
    const d = doc.value!;
    const layer = d.layers.find((l) => l.id === toneLayerId)!;
    const r = toneRect.value;
    perf.lastStamp = timeMs(() => {
      fillScreentoneRect(layer, d.width, d.height, r, {
        pitch: tone.pitch,
        angle: tone.angle,
        density: tone.density,
        color: hexToRgb(tone.color),
      });
    });
    d.syncLayer(toneLayerId, r);
    toneRect.value = null;
    redraw();
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
  if (e.code === "Space" && !isTyping(e)) {
    spaceDown.value = true;
    e.preventDefault();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selectedTextId.value && !isTyping(e)) {
    const d = doc.value!;
    d.texts = d.texts.filter((t) => t.id !== selectedTextId.value);
    selectedTextId.value = null;
    redraw();
  }
}
function onKeyUp(e: KeyboardEvent): void {
  if (e.code === "Space") spaceDown.value = false;
}
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === "TEXTAREA" || t.tagName === "INPUT";
}

// ---- 圖層可見性 ----
function toggleLayer(l: RasterLayer): void {
  l.visible = !l.visible;
  redrawKey.value++;
  redraw();
}

// ---- 文字面板編輯 ----
function onTextEdited(): void {
  redraw();
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
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
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
});

const canvasTransform = computed(
  () => `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
);
const toneOverlayStyle = computed(() => {
  if (!toneRect.value) return { display: "none" };
  const p = toScreen(toneRect.value.x, toneRect.value.y);
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${toneRect.value.w * view.scale}px`,
    height: `${toneRect.value.h * view.scale}px`,
  };
});

const cursorClass = computed(() => {
  if (spaceDown.value || panning || tool.value === "hand") return "cursor-grab";
  if (tool.value === "text") return "cursor-text";
  return "cursor-crosshair";
});

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "hand", label: "手（平移）", key: "Space" },
  { id: "brush", label: "筆刷", key: "B" },
  { id: "erase", label: "橡皮擦", key: "E" },
  { id: "tone", label: "網點", key: "G" },
  { id: "text", label: "文字", key: "T" },
];
</script>

<template>
  <div class="flex h-full w-full text-sm">
    <!-- 左:工具列 -->
    <aside class="flex w-40 flex-col gap-1 border-r p-2" style="border-color: var(--border); background: var(--panel)">
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
      >
        <canvas
          v-show="doc"
          ref="canvasEl"
          class="absolute left-0 top-0 origin-top-left"
          style="image-rendering: pixelated; box-shadow: 0 0 0 1px var(--border)"
          :style="{ transform: canvasTransform }"
        />
        <!-- 網點拖曳預覽框 -->
        <div
          class="pointer-events-none absolute border border-dashed"
          style="border-color: var(--accent); background: rgba(201,100,66,0.12)"
          :style="toneOverlayStyle"
        />
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
      <!-- 工具參數 -->
      <section v-if="tool === 'brush' || tool === 'erase'">
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted)">筆刷</h3>
        <label class="block">大小 {{ brush.size }}px
          <input type="range" min="2" max="120" v-model.number="brush.size" class="w-full" />
        </label>
        <label class="block">硬度 {{ brush.hardness.toFixed(2) }}
          <input type="range" min="0" max="1" step="0.01" v-model.number="brush.hardness" class="w-full" />
        </label>
        <label class="mt-1 flex items-center gap-2" v-if="tool === 'brush'">顏色
          <input type="color" v-model="brush.color" />
        </label>
      </section>

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
            v-model="selectedText.text"
            rows="3"
            class="w-full rounded p-1"
            style="background: var(--panel-2); color: var(--fg)"
            @input="onTextEdited"
          />
          <label class="block mt-1">字級 {{ selectedText.fontSizePx }}px
            <input type="range" min="8" max="120" v-model.number="selectedText.fontSizePx" class="w-full" @input="onTextEdited" />
          </label>
          <div class="mt-1 flex gap-1">
            <button
              class="flex-1 rounded px-1 py-1"
              :style="selectedText.direction === 'horizontal' ? 'background: var(--accent); color:#fff' : 'background: var(--panel-2)'"
              @click="selectedText.direction = 'horizontal'; onTextEdited()"
            >橫排</button>
            <button
              class="flex-1 rounded px-1 py-1"
              :style="selectedText.direction === 'vertical' ? 'background: var(--accent); color:#fff' : 'background: var(--panel-2)'"
              @click="selectedText.direction = 'vertical'; onTextEdited()"
            >直排</button>
          </div>
          <label class="mt-1 flex items-center gap-2">顏色
            <input type="color" v-model="selectedText.color" @input="onTextEdited" />
          </label>
          <p class="mt-1 text-[11px]" style="color: var(--muted)">Delete 刪除選取文字</p>
        </template>
        <p v-else class="text-[11px]" style="color: var(--muted)">點畫布空白處新增文字物件。</p>
      </section>

      <!-- 圖層 -->
      <section>
        <h3 class="mb-1 text-xs font-semibold" style="color: var(--muted)">圖層</h3>
        <ul :key="redrawKey">
          <li
            v-for="l in [...layerList].reverse()"
            :key="l.id"
            class="flex items-center gap-2 rounded px-2 py-1"
            style="background: var(--panel-2)"
          >
            <input type="checkbox" :checked="l.visible" @change="toggleLayer(l)" />
            <span>{{ l.name }}</span>
          </li>
        </ul>
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
        <p class="mt-1 leading-tight" style="color: var(--muted)">
          顯示走 drawImage；純 CPU 合成數字是「若要自訂混合模式手刻合成」的成本參考。
        </p>
      </section>
    </aside>
  </div>
</template>
