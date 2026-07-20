<template>
  <div
    class="absolute flex h-6 w-6 cursor-grab items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
    :class="[selected && 'outline-2 outline-offset-2 outline-white']"
    :style="markerStyle"
    :draggable="nativeDraggable"
    @pointerdown.stop="emit('markerPointerdown', $event)"
    @contextmenu.stop="emit('markerContextmenu', $event)"
    @dblclick.stop="emit('markerDblclick')"
    @dragstart.stop="emit('markerDragstart', $event)"
    @dragend="emit('markerDragend', $event)"
  >
    {{ index + 1 }}
    <!-- 檢查模式：常駐顯示分組名（原版 AlwaysShowGroup） -->
    <span
      v-if="showGroup"
      class="absolute top-1/2 left-full ml-1 -translate-y-1/2 rounded-sm px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-white"
      :style="{ backgroundColor: color }"
    >
      {{ groupName }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LabelItem } from '@/types/project'
import { percentToContentPx } from '@/lib/coords'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()

const props = defineProps<{
  label: LabelItem
  /** 在檔案內的順序（顯示編號 = index + 1） */
  index: number
  /** 外層 stage 的縮放值，用於反縮放讓徽章視覺尺寸恆定 */
  scale: number
  /** 外層 stage 的旋轉(弧度),用於反旋轉讓徽章保持正立 */
  rotate?: number
  natural: { w: number; h: number }
  selected?: boolean
  /** 檢查模式：顯示分組名 */
  showGroup?: boolean
  groupName?: string
  nativeDraggable?: boolean
}>()

// 拖曳/選取的幾何運算集中在 CanvasView（它擁有 view 與 container），
// marker 只轉發選取與原生拖曳事件，並擋住冒泡（避免觸發畫布點擊）
const emit = defineEmits<{
  markerPointerdown: [e: PointerEvent]
  /** 雙擊 = 進輸入層(等同 modal 鍵盤層的 i) */
  markerDblclick: []
  markerContextmenu: [e: MouseEvent]
  markerDragstart: [e: DragEvent]
  markerDragend: [e: DragEvent]
}>()

const color = computed(() => {
  if (props.label.groupId === null) return 'rgb(128, 128, 128)'
  return project.header.groups.find((g) => g.id === props.label.groupId)?.color ?? 'rgb(128, 128, 128)'
})

const markerStyle = computed(() => {
  const p = percentToContentPx(props.label.x, props.label.y, props.natural.w, props.natural.h)
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    // transform-origin 保持預設 center：translate(-50%,-50%) 讓中心落在錨點，
    // rotate(-θ)/scale(1/s) 抵銷外層旋轉縮放後中心仍不動（origin 改 0 0 反而會偏）
    transform: `translate(-50%, -50%) rotate(${-(props.rotate ?? 0)}rad) scale(${1 / props.scale})`,
    backgroundColor: color.value,
  }
})
</script>
