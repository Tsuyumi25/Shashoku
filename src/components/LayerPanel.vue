<script setup lang="ts">
import { nextTick, ref, watch, computed } from "vue";
import draggable from "vuedraggable";
import {
  ArrowDownToLine,
  Blend,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "@lucide/vue";
import { BLEND_MODES, BLEND_MODE_LABELS, type BlendMode } from "@/engine/blend";
import type { RasterLayer } from "@/engine/types";
import {
  addLayer,
  duplicateLayer,
  mergeLayerDown,
  removeLayer,
  renameLayer,
  reorderLayer,
  setLayerProps,
} from "@/editor/actions";
import { useEditor } from "@/editor/useEditor";

const editor = useEditor();
const { activeLayerId, layersTick } = editor;

// UI 由上到下 = stack 由頂到底(PS 慣例)
const uiLayers = computed(() => [...editor.layers.value].reverse());
const active = editor.activeLayer;

const hint = ref("");

// ---- 拖曳重排:UI(反轉)索引 → stack 索引 ----
function onDragEnd(e: { oldIndex?: number; newIndex?: number }): void {
  if (e.oldIndex === undefined || e.newIndex === undefined || e.oldIndex === e.newIndex) return;
  const n = editor.layers.value.length;
  reorderLayer(editor.ctx(), n - 1 - e.oldIndex, n - 1 - e.newIndex);
}

// ---- 列操作 ----
function selectLayer(l: RasterLayer): void {
  activeLayerId.value = l.id;
}

function toggleVisible(l: RasterLayer): void {
  setLayerProps(editor.ctx(), l.id, { visible: !l.visible });
}

function toggleLocked(l: RasterLayer): void {
  setLayerProps(editor.ctx(), l.id, { locked: !l.locked });
}

function toggleAlphaLocked(l: RasterLayer): void {
  setLayerProps(editor.ctx(), l.id, { alphaLocked: !l.alphaLocked });
}

// ---- header 操作(對 active 層) ----
function onAdd(): void {
  const layer = addLayer(editor.ctx());
  activeLayerId.value = layer.id;
}

function onDuplicate(): void {
  if (!active.value) return;
  const copy = duplicateLayer(editor.ctx(), active.value.id);
  if (copy) activeLayerId.value = copy.id;
}

function onMergeDown(): void {
  if (!active.value) return;
  const idx = editor.ctx().doc.layerIndex(active.value.id);
  const below = idx > 0 ? editor.layers.value[idx - 1] : null;
  if (mergeLayerDown(editor.ctx(), active.value.id) && below) {
    activeLayerId.value = below.id;
  }
}

function onRemove(): void {
  if (!active.value) return;
  const idx = editor.ctx().doc.layerIndex(active.value.id);
  if (removeLayer(editor.ctx(), active.value.id)) {
    const next = editor.layers.value[Math.max(0, idx - 1)];
    if (next) activeLayerId.value = next.id;
  }
}

function onOpacityInput(e: Event): void {
  if (!active.value) return;
  const v = Number((e.target as HTMLInputElement).value) / 100;
  setLayerProps(editor.ctx(), active.value.id, { opacity: v });
}

function onBlendChange(e: Event): void {
  if (!active.value) return;
  setLayerProps(editor.ctx(), active.value.id, {
    blendMode: (e.target as HTMLSelectElement).value as BlendMode,
  });
}

// ---- 雙擊改名 ----
const editingId = ref<string | null>(null);
const editingName = ref("");

async function startRename(l: RasterLayer): Promise<void> {
  editingId.value = l.id;
  editingName.value = l.name;
  await nextTick();
  const input = document.getElementById(`layer-rename-${l.id}`) as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

function commitRename(): void {
  if (editingId.value && editingName.value.trim()) {
    renameLayer(editor.ctx(), editingId.value, editingName.value.trim());
  }
  editingId.value = null;
}

// ---- 縮圖(棋盤底 + 該層 canvas 縮放) ----
const thumbEls = new Map<string, HTMLCanvasElement>();

function setThumbEl(id: string, el: unknown): void {
  if (el instanceof HTMLCanvasElement) thumbEls.set(id, el);
  else thumbEls.delete(id);
}

function drawThumbs(): void {
  const d = editor.doc.value;
  if (!d) return;
  for (const [id, el] of thumbEls) {
    const c = el.getContext("2d");
    if (!c) continue;
    c.clearRect(0, 0, el.width, el.height);
    // 棋盤透明底
    for (let y = 0; y < el.height; y += 6) {
      for (let x = 0; x < el.width; x += 6) {
        c.fillStyle = ((x + y) / 6) % 2 === 0 ? "#555" : "#3d3d3a";
        c.fillRect(x, y, 6, 6);
      }
    }
    const src = d.layerCanvas(id);
    if (!src) continue;
    const s = Math.min(el.width / d.width, el.height / d.height);
    const w = d.width * s;
    const h = d.height * s;
    c.drawImage(src, (el.width - w) / 2, (el.height - h) / 2, w, h);
  }
}

watch(
  [layersTick, editor.doc],
  async () => {
    await nextTick();
    drawThumbs();
  },
  { immediate: true }
);

/** Ctrl+click 縮圖 = 把該層 alpha 載入為選區(PS 肌肉記憶)。 */
function onThumbClick(e: MouseEvent, l: RasterLayer): void {
  if (!e.ctrlKey) return;
  e.stopPropagation();
  const alpha = editor.doc.value?.extractAlpha(l.id);
  if (!alpha) return;
  editor.setSelection(alpha);
  hint.value = editor.selection.value
    ? `已載入「${l.name}」的選區（Ctrl+D 取消）`
    : `「${l.name}」是空層，沒有可選像素`;
}
</script>

<template>
  <section>
    <!-- header:blend + opacity(對 active 層,PS 面板頂部慣例) -->
    <div class="mb-1 flex items-center gap-1">
      <select
        class="min-w-0 flex-1 rounded px-1 py-0.5 text-xs"
        style="background: var(--accent); color: var(--foreground)"
        :value="active?.blendMode ?? 'normal'"
        :disabled="!active"
        @change="onBlendChange"
      >
        <option v-for="m in BLEND_MODES" :key="m" :value="m">{{ BLEND_MODE_LABELS[m] }}</option>
      </select>
      <label class="flex items-center gap-1 text-[10px]" style="color: var(--muted-foreground)">
        <span>不透明</span>
        <input
          type="range"
          min="0"
          max="100"
          class="w-16"
          :value="Math.round((active?.opacity ?? 1) * 100)"
          :disabled="!active"
          @input="onOpacityInput"
        />
        <span class="w-7 text-right">{{ Math.round((active?.opacity ?? 1) * 100) }}%</span>
      </label>
    </div>

    <!-- 圖層列表(拖曳重排) -->
    <draggable
      :list="uiLayers"
      item-key="id"
      handle=".drag-handle"
      :animation="120"
      @end="onDragEnd"
    >
      <template #item="{ element: l }">
        <div
          class="mb-0.5 flex items-center gap-1 rounded px-1 py-1"
          :style="
            l.id === activeLayerId
              ? 'background: var(--primary); color: var(--primary-foreground)'
              : 'background: var(--accent)'
          "
          @click="selectLayer(l)"
        >
          <GripVertical class="drag-handle h-3.5 w-3.5 shrink-0 cursor-grab opacity-40" />
          <button class="shrink-0" :title="l.visible ? '隱藏' : '顯示'" @click.stop="toggleVisible(l)">
            <Eye v-if="l.visible" class="h-3.5 w-3.5" />
            <EyeOff v-else class="h-3.5 w-3.5 opacity-40" />
          </button>
          <canvas
            :ref="(el) => setThumbEl(l.id, el)"
            width="36"
            height="36"
            class="shrink-0"
            style="box-shadow: 0 0 0 1px var(--border)"
            title="Ctrl+click 載入選區"
            @click="onThumbClick($event, l)"
          />
          <input
            v-if="editingId === l.id"
            :id="`layer-rename-${l.id}`"
            v-model="editingName"
            class="min-w-0 flex-1 rounded px-1 text-xs"
            style="background: var(--card); color: var(--foreground)"
            @keydown.enter="commitRename"
            @keydown.esc="editingId = null"
            @blur="commitRename"
            @click.stop
          />
          <span
            v-else
            class="min-w-0 flex-1 truncate text-xs"
            :class="{ 'opacity-50': !l.visible }"
            @dblclick.stop="startRename(l)"
          >
            {{ l.name }}
          </span>
          <button
            class="shrink-0"
            :title="l.alphaLocked ? '解除透明鎖定' : '鎖定透明像素'"
            @click.stop="toggleAlphaLocked(l)"
          >
            <Blend class="h-3.5 w-3.5" :class="l.alphaLocked ? '' : 'opacity-25'" />
          </button>
          <button class="shrink-0" :title="l.locked ? '解除鎖定' : '鎖定圖層'" @click.stop="toggleLocked(l)">
            <Lock v-if="l.locked" class="h-3.5 w-3.5" />
            <LockOpen v-else class="h-3.5 w-3.5 opacity-25" />
          </button>
        </div>
      </template>
    </draggable>

    <!-- footer:新增/複製/向下合併/刪除 + undo/redo -->
    <div class="mt-1 flex items-center gap-1 border-t pt-1" style="border-color: var(--border)">
      <button class="rounded p-1" style="background: var(--accent)" title="新增圖層（Ctrl+Shift+N）" @click="onAdd">
        <Plus class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="複製圖層（Ctrl+J）"
        :disabled="!active"
        @click="onDuplicate"
      >
        <Copy class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="向下合併（Ctrl+E）"
        :disabled="!active"
        @click="onMergeDown"
      >
        <ArrowDownToLine class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="刪除圖層"
        :disabled="!active"
        @click="onRemove"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
      <span class="flex-1" />
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        :disabled="!editor.canUndo.value"
        :title="`復原 ${editor.history.undoLabel ?? ''}（Ctrl+Z）`"
        @click="editor.undo()"
      >
        <Undo2 class="h-3.5 w-3.5" :class="editor.canUndo.value ? '' : 'opacity-25'" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        :disabled="!editor.canRedo.value"
        :title="`重做 ${editor.history.redoLabel ?? ''}（Ctrl+Shift+Z）`"
        @click="editor.redo()"
      >
        <Redo2 class="h-3.5 w-3.5" :class="editor.canRedo.value ? '' : 'opacity-25'" />
      </button>
    </div>
    <p v-if="hint" class="mt-1 text-[10px] leading-tight" style="color: var(--muted-foreground)">{{ hint }}</p>
  </section>
</template>
