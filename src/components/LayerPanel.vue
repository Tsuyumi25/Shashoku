<script setup lang="ts">
// 圖層面板:PS/CSP-like 樹狀呈現 + 完全自由拖曳。
//
// 拖曳架構:
// - root 是**單一 <draggable>**,任何 kind(raster / text / style folder / regular
//   group)在同一條 list 裡自由排序;normalize 保留 tree 順序,不 zone。
// - 每個 folder body 是自己的 nested <draggable>(在 LayerRow 內),共享 group
//   name "layer-tree" 讓跨容器拖曳成立;moveGuard 只擋:
//     • 樣式 folder body 只吃 text(拖 raster 進樣式 folder → 拒)
//     • 一般 group body 拒樣式 folder(樣式 folder 不能被巢狀)
//     • group 不能拖進自己 descendant
//   root 一律放行——用戶想怎麼排就怎麼排。
//
// SSOT 翻譯(拖曳完成後):
// - text 進樣式 folder → label.groupId = folder.styleBinding.labelGroupId(+ undo)
// - text 進 root / regular group → label.groupId = null(+ undo)
//   * 這個耦合是必要的,因為 label.groupId 綁的是「文字用哪組樣式 preset」——
//     用戶拖進 folder 就是明示要用那組樣式。
//
// 多選:activeLayerIds Set,Ctrl+click toggle、Shift+click 範圍選、單擊 replace。
// 拖曳一個 = 直接就拖那個(若拖的節點不在 selection 內先變成單選再拖)。
//
// 顯示順序:composite bottom→top 反轉為視覺 top→bottom(對齊 PS/CSP);
//   root 用 rootLayers ref 存反轉後的視覺序,拖曳後 reverse 寫回 doc.layers。
// Row 高度:small / medium / large 三檔,session-local ref,不持久化。
//
// Header controls(blend / opacity / alphaLock / lock)走 CSP mixed 語意:
//   多選時值一致顯示該值;不一致顯示「混合」/dash;改動時套用到所有選中 raster。
import { nextTick, provide, ref, watch } from "vue";
import draggable from "vuedraggable";
import {
  ArrowDownToLine,
  Blend,
  Copy,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  Rows2,
  Rows3,
  Rows4,
  Trash2,
  Undo2,
} from "@lucide/vue";
import { BLEND_MODES, BLEND_MODE_LABELS, type BlendMode } from "@/engine/blend";
import type { GroupLayerNode, Layer } from "@/engine/layer-tree";
import type { RasterLayer } from "@/engine/types";
import {
  addLayer,
  duplicateLayer,
  mergeLayerDown,
  removeLayer,
  setLayerProps,
} from "@/editor/actions";
import { useEditor } from "@/editor/useEditor";
import { useProjectStore } from "@/stores/projectStore";
import LayerRow, { type RowSize } from "./LayerRow.vue";

const editor = useEditor();
const project = useProjectStore();
const { activeLayerId, activeRasterLayers, layersTick } = editor;

// ---- 拖入 folder 高亮(CSP 紅框)provide 給 LayerRow ----
const dragIntoFolderId = ref<string | null>(null);
provide("dragIntoFolderId", dragIntoFolderId);

// ---- root layers ref(反轉為視覺序,拖曳後 reverse 寫回 doc.layers)----
const rootLayers = ref<Layer[]>([]);
watch(
  () => editor.tree.value,
  (tree) => {
    rootLayers.value = [...tree].reverse();
  },
  { immediate: true },
);

function syncDocLayers(): void {
  const d = editor.doc.value;
  if (!d) return;
  d.layers = [...rootLayers.value].reverse();
}

// ---- vuedraggable options ----
const dragGroup = { name: "layer-tree" };

function isStyleFolder(n: Layer): n is GroupLayerNode {
  return n.kind === "group" && n.styleBinding !== undefined;
}

function isDescendantContainer(group: GroupLayerNode, targetContainerId: string): boolean {
  if (!targetContainerId) return false;
  const stack: Layer[] = [...group.children];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.kind === "group") {
      if (n.id === targetContainerId) return true;
      stack.push(...n.children);
    }
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function moveGuard(evt: any): boolean {
  const dragged = evt.draggedContext?.element as Layer | undefined;
  if (!dragged) return true;
  const toEl = evt.to as HTMLElement | undefined;
  const toType = toEl?.dataset?.containerType ?? "";
  const toContainerId = toEl?.dataset?.containerType && toEl.dataset.containerType !== "root"
    ? toEl.dataset.containerId ?? ""
    : "";

  // 更新「拖進 folder」高亮 state
  if (toType === "style-folder" || toType === "regular-group") {
    dragIntoFolderId.value = toContainerId || null;
  } else {
    dragIntoFolderId.value = null;
  }

  // 1. Group into descendant guard
  if (dragged.kind === "group" && isDescendantContainer(dragged, toContainerId)) return false;

  // 2. Container kind acceptance
  switch (toType) {
    case "root":
      return true;
    case "style-folder":
      return dragged.kind === "text";
    case "regular-group":
      return !isStyleFolder(dragged); // 拒樣式 folder(樣式 folder 只能在 root)
  }
  return true;
}

function onDragEnd(): void {
  dragIntoFolderId.value = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DragEvt = any;

/** text 進 folder → 改 label.groupId + push undo。 */
function updateLabelGroupIdWithUndo(labelId: string, newGroupId: string | null): void {
  const page = editor.docPage.value;
  if (!page) return;
  const file = project.files.find((f) => f.filename === page);
  const label = file?.labels.find((l) => l.id === labelId);
  if (!label) return;
  const oldGroupId = label.groupId;
  if (oldGroupId === newGroupId) return;
  project.updateLabelGroupId(page, labelId, newGroupId);
  editor.history.push({
    label: newGroupId === null ? "文字移出樣式群組" : "文字進樣式群組",
    undo: () => project.updateLabelGroupId(page, labelId, oldGroupId),
    redo: () => project.updateLabelGroupId(page, labelId, newGroupId),
  });
}

function onRootChange(evt: DragEvt): void {
  if (evt.added) {
    const el = evt.added.element as Layer;
    // text 從 folder 出來到 root → 清 groupId
    if (el.kind === "text") updateLabelGroupIdWithUndo(el.labelId, null);
  }
  syncDocLayers();
  editor.changed();
}

/** LayerRow 的 folder body 變更冒上來——ctx 標 folder 種類。 */
function onFolderChange(folder: GroupLayerNode, evt: DragEvt): void {
  if (evt.added) {
    const el = evt.added.element as Layer;
    if (el.kind === "text") {
      const targetGroupId = folder.styleBinding?.labelGroupId ?? null; // style folder 才綁,regular group 清成 null
      updateLabelGroupIdWithUndo(el.labelId, targetGroupId);
    }
  }
  // 內部 mutations 已由 LayerRow 就地寫回 folder.children + editor.changed
}

// ---- 多選點擊:單/Ctrl/Shift ----

/** 把 tree 攤平成單一 id 序(供 Shift 範圍選用);跟拖曳視覺順序一致(反轉) */
function flattenIds(): string[] {
  const acc: string[] = [];
  const walk = (nodes: readonly Layer[]): void => {
    // 反向 walk 對齊視覺 top→bottom
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      acc.push(n.id);
      if (n.kind === "group") walk(n.children);
    }
  };
  walk(editor.tree.value);
  return acc;
}

function onRowClick(id: string, evt: MouseEvent): void {
  if (evt.ctrlKey || evt.metaKey) {
    editor.toggleActiveLayer(id);
    return;
  }
  if (evt.shiftKey) {
    // 範圍選:從當前 activeLayerId(最後單擊的 anchor)到 id 之間全選
    const anchor = activeLayerId.value;
    if (!anchor) {
      activeLayerId.value = id;
      return;
    }
    const flat = flattenIds();
    const ai = flat.indexOf(anchor);
    const ti = flat.indexOf(id);
    if (ai < 0 || ti < 0) {
      activeLayerId.value = id;
      return;
    }
    const [lo, hi] = ai < ti ? [ai, ti] : [ti, ai];
    const range = flat.slice(lo, hi + 1);
    editor.setActiveLayers(range);
    return;
  }
  // 單擊:replace 選中
  activeLayerId.value = id;
}

// ---- Row 高度三檔(session-local)----
const rowSize = ref<RowSize>("medium");
function cycleSize(target: RowSize): void {
  rowSize.value = target;
}

// ---- 樹展開狀態 ----
const expanded = ref(new Set<string>());
function toggleExpand(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
watch(
  () => editor.tree.value,
  (tree) => {
    const groupIds = new Set<string>();
    const walk = (nodes: readonly Layer[]): void => {
      for (const n of nodes) {
        if (n.kind === "group") {
          groupIds.add(n.id);
          walk((n as GroupLayerNode).children);
        }
      }
    };
    walk(tree);
    const next = new Set(expanded.value);
    for (const id of groupIds) if (!next.has(id)) next.add(id);
    for (const id of next) if (!groupIds.has(id)) next.delete(id);
    expanded.value = next;
  },
  { immediate: true, deep: true },
);

const hint = ref("");

// ---- Header CSP-mixed 顯示 ----
// none = 沒選任何 raster;mixed = 多選但值不一致;else = 共同值
type Mixed<T> = { kind: "none" } | { kind: "mixed" } | { kind: "same"; value: T };

function commonOf<T>(rasters: readonly RasterLayer[], key: (r: RasterLayer) => T): Mixed<T> {
  if (rasters.length === 0) return { kind: "none" };
  const first = key(rasters[0]);
  for (let i = 1; i < rasters.length; i++) {
    if (key(rasters[i]) !== first) return { kind: "mixed" };
  }
  return { kind: "same", value: first };
}

// ---- raster 專屬 header 動作(套用到所有選中 raster)----
function onOpacityInput(e: Event): void {
  if (activeRasterLayers.value.length === 0) return;
  const v = Number((e.target as HTMLInputElement).value) / 100;
  const ctx = editor.ctx();
  for (const r of activeRasterLayers.value) setLayerProps(ctx, r.id, { opacity: v });
}
function onBlendChange(e: Event): void {
  const val = (e.target as HTMLSelectElement).value;
  if (val === "__mixed__" || activeRasterLayers.value.length === 0) return;
  const ctx = editor.ctx();
  for (const r of activeRasterLayers.value) setLayerProps(ctx, r.id, { blendMode: val as BlendMode });
}
function onAdd(): void {
  const layer = addLayer(editor.ctx());
  activeLayerId.value = layer.id;
}
function onDuplicate(): void {
  // 多選:每個都 duplicate,選中變成 duplicate 的產物
  if (activeRasterLayers.value.length === 0) return;
  const ctx = editor.ctx();
  const newIds: string[] = [];
  for (const r of activeRasterLayers.value) {
    const copy = duplicateLayer(ctx, r.id);
    if (copy) newIds.push(copy.id);
  }
  if (newIds.length) editor.setActiveLayers(newIds);
}
function onMergeDown(): void {
  // 單目標:用 activeLayer(primary),多選時只合最上面那個
  const a = editor.activeLayer.value;
  if (!a) return;
  const idx = editor.ctx().doc.layerIndex(a.id);
  const below = idx > 0 ? editor.layers.value[idx - 1] : null;
  if (mergeLayerDown(editor.ctx(), a.id) && below) {
    activeLayerId.value = below.id;
  }
}
function onRemove(): void {
  if (activeRasterLayers.value.length === 0) return;
  const ctx = editor.ctx();
  const ids = activeRasterLayers.value.map((r) => r.id);
  let lastIdxBefore = -1;
  for (const id of ids) {
    const idx = ctx.doc.layerIndex(id);
    if (idx >= 0 && idx > lastIdxBefore) lastIdxBefore = idx;
    removeLayer(ctx, id);
  }
  // 選中回退到刪除範圍的最下方那層
  const next = editor.layers.value[Math.max(0, lastIdxBefore - ids.length)];
  if (next) activeLayerId.value = next.id;
  else editor.setActiveLayers([]);
}
function toggleActiveAlphaLock(): void {
  const rs = activeRasterLayers.value;
  if (rs.length === 0) return;
  // 全都 locked → 解鎖;否則(全解 / mixed)全鎖
  const allLocked = rs.every((r) => r.alphaLocked);
  const target = !allLocked;
  const ctx = editor.ctx();
  for (const r of rs) setLayerProps(ctx, r.id, { alphaLocked: target });
}
function toggleActiveLock(): void {
  const rs = activeRasterLayers.value;
  if (rs.length === 0) return;
  const allLocked = rs.every((r) => r.locked);
  const target = !allLocked;
  const ctx = editor.ctx();
  for (const r of rs) setLayerProps(ctx, r.id, { locked: target });
}

// ---- text 節點內容(給 LayerRow 顯示)----
function labelText(labelId: string): string {
  for (const f of project.files) {
    const l = f.labels.find((x) => x.id === labelId);
    if (l) return l.text.split("\n")[0].slice(0, 18);
  }
  return "";
}
function labelColor(labelId: string): string | null {
  for (const f of project.files) {
    const l = f.labels.find((x) => x.id === labelId);
    if (l) {
      const g = l.groupId ? project.header.groups.find((gg) => gg.id === l.groupId) : null;
      return g?.color ?? null;
    }
  }
  return null;
}

// ---- 縮圖 ----
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
  { immediate: true },
);

function onThumbClick(e: MouseEvent, l: RasterLayer): void {
  if (!e.ctrlKey) return;
  const alpha = editor.doc.value?.extractAlpha(l.id);
  if (!alpha) return;
  editor.setSelection(alpha);
  hint.value = editor.selection.value
    ? `已載入「${l.name}」的選區(Ctrl+D 取消)`
    : `「${l.name}」是空層,沒有可選像素`;
}
</script>

<template>
  <section>
    <!-- header:blend + opacity + alphaLock + lock;支援 CSP mixed 顯示 -->
    <div class="mb-1 flex items-center gap-1">
      <!-- blend mode(mixed → 顯示「混合」pseudo option) -->
      <select
        class="min-w-0 flex-1 rounded px-1 py-0.5 text-xs"
        style="background: var(--accent); color: var(--foreground)"
        :value="(() => {
          const c = commonOf(activeRasterLayers, r => r.blendMode);
          return c.kind === 'same' ? c.value : c.kind === 'mixed' ? '__mixed__' : 'normal';
        })()"
        :disabled="activeRasterLayers.length === 0"
        @change="onBlendChange"
      >
        <option v-if="commonOf(activeRasterLayers, r => r.blendMode).kind === 'mixed'" value="__mixed__" disabled>
          混合
        </option>
        <option v-for="m in BLEND_MODES" :key="m" :value="m">{{ BLEND_MODE_LABELS[m] }}</option>
      </select>

      <!-- opacity(mixed → 顯示「混合」+ 中間值)-->
      <label class="flex items-center gap-1 text-[10px]" style="color: var(--muted-foreground)">
        <span>不透明</span>
        <input
          type="range"
          min="0"
          max="100"
          class="w-16"
          :value="(() => {
            const c = commonOf(activeRasterLayers, r => r.opacity);
            if (c.kind === 'same') return Math.round(c.value * 100);
            if (c.kind === 'mixed') return 50;
            return 100;
          })()"
          :disabled="activeRasterLayers.length === 0"
          @input="onOpacityInput"
        />
        <span class="w-10 text-right">
          <template v-if="commonOf(activeRasterLayers, r => r.opacity).kind === 'same'">
            {{ Math.round((commonOf(activeRasterLayers, r => r.opacity) as { value: number }).value * 100) }}%
          </template>
          <template v-else-if="commonOf(activeRasterLayers, r => r.opacity).kind === 'mixed'">混合</template>
          <template v-else>—</template>
        </span>
      </label>

      <!-- alphaLock(mixed → 半透明 icon 提示混合) -->
      <button
        class="shrink-0"
        :disabled="activeRasterLayers.length === 0"
        :title="(() => {
          const c = commonOf(activeRasterLayers, r => r.alphaLocked);
          return c.kind === 'same' ? (c.value ? '解除透明鎖定' : '鎖定透明像素') : '透明鎖定混合中';
        })()"
        @click="toggleActiveAlphaLock"
      >
        <Blend
          class="h-3.5 w-3.5"
          :class="(() => {
            const c = commonOf(activeRasterLayers, r => r.alphaLocked);
            return c.kind === 'same' ? (c.value ? '' : 'opacity-25') : 'opacity-50';
          })()"
        />
      </button>

      <!-- lock -->
      <button
        class="shrink-0"
        :disabled="activeRasterLayers.length === 0"
        :title="(() => {
          const c = commonOf(activeRasterLayers, r => r.locked);
          return c.kind === 'same' ? (c.value ? '解除鎖定' : '鎖定圖層') : '鎖定混合中';
        })()"
        @click="toggleActiveLock"
      >
        <template v-if="commonOf(activeRasterLayers, r => r.locked).kind === 'same' && (commonOf(activeRasterLayers, r => r.locked) as { value: boolean }).value">
          <Lock class="h-3.5 w-3.5" />
        </template>
        <template v-else>
          <LockOpen
            class="h-3.5 w-3.5"
            :class="commonOf(activeRasterLayers, r => r.locked).kind === 'mixed' ? 'opacity-50' : 'opacity-25'"
          />
        </template>
      </button>

      <!-- 列高三檔切換 -->
      <div class="flex shrink-0 items-center border-l pl-1" style="border-color: var(--border)">
        <button
          class="rounded px-0.5"
          :class="rowSize === 'small' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : ''"
          title="小"
          @click="cycleSize('small')"
        >
          <Rows4 class="h-3.5 w-3.5" />
        </button>
        <button
          class="rounded px-0.5"
          :class="rowSize === 'medium' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : ''"
          title="中"
          @click="cycleSize('medium')"
        >
          <Rows3 class="h-3.5 w-3.5" />
        </button>
        <button
          class="rounded px-0.5"
          :class="rowSize === 'large' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : ''"
          title="大"
          @click="cycleSize('large')"
        >
          <Rows2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- 圖層樹:root 單一 sortable(視覺頂→底 = tree 反轉) -->
    <draggable
      :list="rootLayers"
      :group="dragGroup"
      :move="moveGuard"
      item-key="id"
      :animation="150"
      ghost-class="csp-ghost"
      class="flex flex-col gap-0.5"
      style="min-height: 24px"
      data-container-type="root"
      @change="onRootChange"
      @end="onDragEnd"
    >
      <template #item="{ element }">
        <LayerRow
          :node="element as Layer"
          :depth="0"
          :size="rowSize"
          :expanded="expanded"
          :label-text="labelText"
          :label-color="labelColor"
          :thumb-for="setThumbEl"
          :move-guard="moveGuard"
          :on-folder-change="onFolderChange"
          :on-row-click="onRowClick"
          @toggle-expand="toggleExpand"
          @click-thumb="onThumbClick"
        />
      </template>
    </draggable>

    <!-- footer:CRUD + undo/redo -->
    <div class="mt-1 flex items-center gap-1 border-t pt-1" style="border-color: var(--border)">
      <button class="rounded p-1" style="background: var(--accent)" title="新增圖層(Ctrl+Shift+N)" @click="onAdd">
        <Plus class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="複製圖層(Ctrl+J)"
        :disabled="activeRasterLayers.length === 0"
        @click="onDuplicate"
      >
        <Copy class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="向下合併(Ctrl+E,只作用在主選)"
        :disabled="!editor.activeLayer.value"
        @click="onMergeDown"
      >
        <ArrowDownToLine class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        title="刪除圖層(多選一起刪)"
        :disabled="activeRasterLayers.length === 0"
        @click="onRemove"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
      <span class="flex-1" />
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        :disabled="!editor.canUndo.value"
        :title="`復原 ${editor.history.undoLabel ?? ''}(Ctrl+Z)`"
        @click="editor.undo()"
      >
        <Undo2 class="h-3.5 w-3.5" :class="editor.canUndo.value ? '' : 'opacity-25'" />
      </button>
      <button
        class="rounded p-1"
        style="background: var(--accent)"
        :disabled="!editor.canRedo.value"
        :title="`重做 ${editor.history.redoLabel ?? ''}(Ctrl+Shift+Z)`"
        @click="editor.redo()"
      >
        <Redo2 class="h-3.5 w-3.5" :class="editor.canRedo.value ? '' : 'opacity-25'" />
      </button>
    </div>
    <p v-if="hint" class="mt-1 text-[10px] leading-tight" style="color: var(--muted-foreground)">{{ hint }}</p>
  </section>
</template>

<style scoped>
/* CSP-style 紅線 drop indicator:vuedraggable 的 ghost placeholder 被 style
   成一條薄紅條,插入位置就是紅線。內容 visibility:hidden 讓紅條乾淨。 */
.csp-ghost {
  background: #ff3355 !important;
  height: 3px !important;
  min-height: 3px;
  max-height: 3px;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 0 0 1px #ff3355;
}
.csp-ghost * {
  visibility: hidden;
}
</style>
