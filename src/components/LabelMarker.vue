<template>
  <div
    class="absolute flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
    :class="[selected && 'outline-2 outline-offset-2 outline-white']"
    :style="markerStyle"
    @pointerdown.stop="emit('markerPointerdown', $event)"
    @pointermove="emit('markerPointermove', $event)"
    @pointerup="emit('markerPointerup', $event)"
    @pointercancel="emit('markerPointerup', $event)"
    @pointerenter="emit('markerPointerenter')"
    @contextmenu.stop="emit('markerContextmenu', $event)"
    @dblclick.stop
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
import { CATEGORY_COLORS } from '@shared/ssk/constants'
import { percentToContentPx } from '@/lib/coords'

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
}>()

// 拖曳/選取的幾何運算集中在 CanvasView（它擁有 view 與 container），
// marker 只轉發 pointer 事件並擋住冒泡（避免觸發畫布 pan / 點擊新增）
const emit = defineEmits<{
  markerPointerdown: [e: PointerEvent]
  markerPointermove: [e: PointerEvent]
  markerPointerup: [e: PointerEvent]
  markerPointerenter: []
  markerContextmenu: [e: MouseEvent]
}>()

const color = computed(() => CATEGORY_COLORS[props.label.category - 1] ?? 'rgb(128, 128, 128)')

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
