<script setup lang="ts">
// LayerPanel 的遞迴 row。一列 = tree 一個節點。
// - raster / text:單一橫列
// - group folder(樣式 / 一般):橫列 + 內含 nested <draggable> 讓 children 可拖曳重排
//
// 顯示順序反轉:composite 序 index 0 = 視覺底,PS/CSP 慣例 = 視覺頂在面板頂,
// 所以 root 和每個 folder body 都把 children [...].reverse() 顯示。拖曳完再
// reverse 寫回 tree,tree 內部仍是 composite 序,合成 pipeline 不受影響。
//
// 點擊(單/Ctrl/Shift 修飾)由 parent(LayerPanel)統一處理——LayerRow 只
// 呼叫 onRowClick(id, event) 把責任丟出去。
import { computed, inject, ref, watch, type Ref } from "vue";
import draggable from "vuedraggable";
import { ChevronDown, ChevronRight, Eye, EyeOff, FolderOpen, Layers, Type } from "@lucide/vue";
import type { GroupLayerNode, Layer, TextLayerNode } from "@/engine/layer-tree";
import type { RasterLayer } from "@/engine/types";
import { setLayerProps } from "@/editor/actions";
import { useEditor } from "@/editor/useEditor";
import { useProjectStore } from "@/stores/projectStore";

export type RowSize = "small" | "medium" | "large";

const props = defineProps<{
  node: Layer;
  depth: number;
  size: RowSize;
  expanded: Set<string>;
  labelText: (labelId: string) => string;
  labelColor: (labelId: string) => string | null;
  thumbFor: (id: string, el: unknown) => void;
  /** vuedraggable move callback,attribute 級 constraint */
  moveGuard: (evt: unknown) => boolean;
  /** folder body 的 @change 冒到 parent,由 parent 處理 SSOT 翻譯 */
  onFolderChange: (folder: GroupLayerNode, evt: unknown) => void;
  /** row click(單/Ctrl/Shift 都走這條)由 parent 處理選中邏輯 */
  onRowClick: (id: string, evt: MouseEvent) => void;
}>();

const emit = defineEmits<{
  toggleExpand: [id: string];
  clickThumb: [e: MouseEvent, layer: RasterLayer];
}>();

const editor = useEditor();
const project = useProjectStore();

// 拖入 folder 時的高亮 target(CSP 紅框);由 LayerPanel 於 moveGuard 更新
const dragIntoFolderId = inject<Ref<string | null>>("dragIntoFolderId", ref(null));

const isFolder = computed(() => props.node.kind === "group");
const isOpen = computed(() => props.expanded.has(props.node.id));
const isStyleFolder = computed(
  () => props.node.kind === "group" && props.node.styleBinding !== undefined,
);
const isSelected = computed(() => editor.activeLayerIds.value.has(props.node.id));
const isDropTarget = computed(() => isFolder.value && dragIntoFolderId.value === props.node.id);

const styleGroupName = computed(() => {
  if (props.node.kind !== "group" || !props.node.styleBinding) return null;
  const gid = props.node.styleBinding.labelGroupId;
  return project.header.groups.find((g) => g.id === gid)?.name ?? "(未知群組)";
});

const styleGroupColor = computed(() => {
  if (props.node.kind !== "group" || !props.node.styleBinding) return null;
  const gid = props.node.styleBinding.labelGroupId;
  return project.header.groups.find((g) => g.id === gid)?.color ?? null;
});

// ---- size 三檔對應 Tailwind class ----
const sizeClasses = computed(() => {
  switch (props.size) {
    case "small":
      return {
        row: "gap-1 px-1 py-0.5 text-[11px]",
        icon: "h-3 w-3",
        thumbPx: 20,
        chevronSlot: "w-3",
      };
    case "large":
      return {
        row: "gap-2 px-2 py-3 text-sm",
        icon: "h-5 w-5",
        thumbPx: 48,
        chevronSlot: "w-5",
      };
    case "medium":
    default:
      return {
        row: "gap-1.5 px-1.5 py-1.5 text-xs",
        icon: "h-4 w-4",
        thumbPx: 32,
        chevronSlot: "w-4",
      };
  }
});

function toggleVisible(): void {
  if (props.node.kind === "raster") {
    setLayerProps(editor.ctx(), props.node.id, { visible: !props.node.visible });
  } else {
    props.node.visible = !props.node.visible;
    editor.ctx().changed();
  }
}

// ---- 拖曳:folder body 內部 sortable ----
const dragGroup = { name: "layer-tree" };

// folder.children 反轉為視覺序(頂→底);拖曳完再反轉寫回
const localChildren = ref<Layer[]>([]);
watch(
  [() => props.node, editor.layersTick],
  () => {
    if (props.node.kind === "group") {
      localChildren.value = [...props.node.children].reverse();
    } else {
      localChildren.value = [];
    }
  },
  { immediate: true },
);

function onFolderBodyChange(evt: unknown): void {
  if (props.node.kind !== "group") return;
  // vuedraggable 已就地 splice localChildren;反轉寫回 composite 序
  props.node.children = [...localChildren.value].reverse();
  editor.changed({ raster: false });
  // 讓 parent 處理 SSOT 翻譯(text 進 folder → updateLabelGroupId)
  props.onFolderChange(props.node, evt);
}
</script>

<template>
  <div>
    <!-- 節點本體 -->
    <div
      class="flex items-center rounded transition-colors"
      :class="[
        sizeClasses.row,
        isSelected
          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
          : 'bg-[var(--accent)] hover:bg-[var(--secondary)]',
        isDropTarget ? 'ring-2 ring-[#ff3355]' : '',
      ]"
      :style="{ marginLeft: `${depth * 12}px` }"
      @click="onRowClick(node.id, $event)"
    >
      <!-- 展開/收合 chevron(folder 才有) -->
      <button
        v-if="isFolder"
        class="shrink-0"
        :title="isOpen ? '收合' : '展開'"
        @click.stop="$emit('toggleExpand', node.id)"
      >
        <ChevronDown v-if="isOpen" :class="sizeClasses.icon" />
        <ChevronRight v-else :class="sizeClasses.icon" />
      </button>
      <span v-else class="inline-block shrink-0" :class="sizeClasses.chevronSlot" />

      <!-- kind icon -->
      <FolderOpen
        v-if="node.kind === 'group'"
        class="shrink-0"
        :class="sizeClasses.icon"
        :style="styleGroupColor ? { color: styleGroupColor } : {}"
      />
      <Type v-else-if="node.kind === 'text'" class="shrink-0 opacity-70" :class="sizeClasses.icon" />
      <Layers v-else class="shrink-0 opacity-40" :class="sizeClasses.icon" />

      <!-- visibility -->
      <button class="shrink-0" :title="node.visible ? '隱藏' : '顯示'" @click.stop="toggleVisible">
        <Eye v-if="node.visible" :class="sizeClasses.icon" />
        <EyeOff v-else class="opacity-40" :class="sizeClasses.icon" />
      </button>

      <!-- 縮圖(raster 才有) -->
      <canvas
        v-if="node.kind === 'raster'"
        :ref="(el) => thumbFor(node.id, el)"
        :width="sizeClasses.thumbPx"
        :height="sizeClasses.thumbPx"
        class="shrink-0"
        style="box-shadow: 0 0 0 1px var(--border)"
        title="Ctrl+click 載入選區"
        @click.stop="$emit('clickThumb', $event, node as RasterLayer)"
      />

      <!-- 名稱 / 內容 -->
      <span class="min-w-0 flex-1 truncate" :class="{ 'opacity-50': !node.visible }">
        <template v-if="node.kind === 'group' && styleGroupName">
          {{ styleGroupName }}
          <span class="opacity-50">({{ (node as GroupLayerNode).children.length }})</span>
        </template>
        <template v-else-if="node.kind === 'group'">
          {{ node.name }}
          <span class="opacity-50">({{ (node as GroupLayerNode).children.length }})</span>
        </template>
        <template v-else-if="node.kind === 'text'">
          <span :style="labelColor((node as TextLayerNode).labelId) ? { color: labelColor((node as TextLayerNode).labelId)! } : {}">
            {{ labelText((node as TextLayerNode).labelId) || '(空)' }}
          </span>
        </template>
        <template v-else>{{ node.name }}</template>
      </span>
    </div>

    <!-- children:folder 展開時渲染 nested draggable -->
    <draggable
      v-if="isFolder && isOpen"
      :list="localChildren"
      :group="dragGroup"
      :move="moveGuard"
      item-key="id"
      :animation="150"
      ghost-class="csp-ghost"
      class="flex flex-col gap-0.5 py-0.5"
      :style="{ marginLeft: `${(depth + 1) * 12}px`, minHeight: '8px' }"
      :data-container-type="isStyleFolder ? 'style-folder' : 'regular-group'"
      :data-container-id="node.id"
      @change="onFolderBodyChange"
    >
      <template #item="{ element }">
        <LayerRow
          :node="element as Layer"
          :depth="depth + 1"
          :size="size"
          :expanded="expanded"
          :label-text="labelText"
          :label-color="labelColor"
          :thumb-for="thumbFor"
          :move-guard="moveGuard"
          :on-folder-change="onFolderChange"
          :on-row-click="onRowClick"
          @toggle-expand="(id: string) => emit('toggleExpand', id)"
          @click-thumb="(e: MouseEvent, l: RasterLayer) => emit('clickThumb', e, l)"
        />
      </template>
    </draggable>
  </div>
</template>
