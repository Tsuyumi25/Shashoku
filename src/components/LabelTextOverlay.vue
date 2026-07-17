<template>
  <!-- 標籤文字的 DOM 投影:與嵌字 mode 同一份 labelTextCss → 同一個 Chromium
       排版(直排/標點/字距),校對看到的字 = 嵌字/匯出的字。純顯示 overlay,
       不進像素合成;stage 的 CSS transform 縮放下向量銳利。空標籤由
       LabelMarker 顯示,這裡只畫有字的。 -->
  <div class="pointer-events-none absolute top-0 left-0">
    <div
      v-for="l in textLabels"
      :key="l.id"
      class="absolute"
      :style="{
        ...css,
        left: `${l.x * width}px`,
        top: `${l.y * height}px`,
        transform: 'translate(-50%, -50%)',
      }"
    >{{ l.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LabelItem } from '@/types/project'
import { labelTextCss, type LabelTextStyle } from '@/lib/labelTextStyle'

const props = defineProps<{
  width: number
  height: number
  labels: LabelItem[]
  textStyle: LabelTextStyle
}>()

const css = computed(() => labelTextCss(props.textStyle))
const textLabels = computed(() => props.labels.filter((l) => l.text !== ''))
</script>
