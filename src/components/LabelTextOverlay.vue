<template>
  <!-- 標籤文字的 DOM 投影:與嵌字 mode 同一份 labelTextCss → 同一個 Chromium
       排版(直排/標點/字距),校對看到的字 = 嵌字/匯出的字。純顯示 overlay,
       不進像素合成;stage 的 CSS transform 縮放下向量銳利。空標籤由
       LabelMarker 顯示,這裡只畫有字的。
       文字本體是點擊目標(interactive 時):單擊選取、雙擊編輯——文字是
       畫面上最大的視覺物,點它不該穿透到背景變成誤增標籤。
       樣式解析走繼承鍊 `defaultStyle → groupStyle → label.styleOverride`,
       所以 css 是 per-label 計算(不再是共享一份)。 -->
  <div class="pointer-events-none absolute top-0 left-0">
    <div
      v-for="l in textLabels"
      :key="l.id"
      class="absolute"
      :class="[
        interactive ? `pointer-events-auto ${nativeDraggable ? 'cursor-grab' : 'cursor-default'}` : '',
        l.id === hiddenLabelId && 'opacity-0',
      ]"
      :draggable="nativeDraggable"
      :style="{
        ...cssForLabel(l),
        left: `${l.x * width}px`,
        top: `${l.y * height}px`,
        transform: 'translate(-50%, -50%)',
      }"
      @pointerdown.stop="
        interactive && (emit('select', l.id), emit('labelPointerdown', l, $event))
      "
      @dblclick.stop="interactive && emit('edit', l.id)"
      @dragstart.stop="emit('labelDragstart', l, $event)"
      @dragend="emit('labelDragend', $event)"
    >{{ l.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LabelItem, ProjectHeader } from '@/types/project'
import { effectiveStyleForLabel, labelTextCss } from '@/lib/labelTextStyle'

const props = defineProps<{
  width: number
  height: number
  labels: LabelItem[]
  /** 樣式繼承鍊來源(groups + defaultStyle);label.styleOverride 走 label 自己 */
  header: Pick<ProjectHeader, 'groups' | 'defaultStyle'>
  /** 文字可點選(翻譯 mode);校對等純顯示場景不傳 = 穿透 */
  interactive?: boolean
  nativeDraggable?: boolean
  hiddenLabelId?: string | null
}>()

const emit = defineEmits<{
  /** 單擊文字 = 選取該標籤 */
  select: [id: string]
  /** 雙擊文字 = 選取並進輸入層(等同雙擊 marker) */
  edit: [id: string]
  labelPointerdown: [label: LabelItem, e: PointerEvent]
  labelDragstart: [label: LabelItem, e: DragEvent]
  labelDragend: [e: DragEvent]
}>()

function cssForLabel(label: LabelItem): Record<string, string> {
  return labelTextCss(effectiveStyleForLabel(label, props.header))
}
const textLabels = computed(() => props.labels.filter((l) => l.text !== ''))
</script>
