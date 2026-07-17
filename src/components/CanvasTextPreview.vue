<template>
  <canvas
    ref="canvasRef"
    class="pointer-events-none absolute top-0 left-0"
    :style="{ width: `${width}px`, height: `${height}px` }"
  />
</template>

<script setup lang="ts">
import { useTemplateRef, watchPostEffect } from 'vue'
import type { LabelItem } from '@/types/project'
import {
  canvasFont,
  drawCanvasTextPreview,
  type CanvasTextPreviewStyle,
} from '@/lib/canvasTextPreview'

const props = defineProps<{
  width: number
  height: number
  labels: LabelItem[]
  textStyle: CanvasTextPreviewStyle
}>()

const canvasRef = useTemplateRef('canvasRef')

watchPostEffect(() => {
  const canvas = canvasRef.value
  if (!canvas || props.width <= 0 || props.height <= 0) return

  // backing store 與原圖像素一一對齊；外層 stage 負責和圖片一起 zoom/pan。
  if (canvas.width !== props.width) canvas.width = props.width
  if (canvas.height !== props.height) canvas.height = props.height

  const context = canvas.getContext('2d')
  if (!context) return

  function draw(currentContext: CanvasRenderingContext2D) {
    currentContext.clearRect(0, 0, props.width, props.height)
    for (const label of props.labels) {
      drawCanvasTextPreview(currentContext, label, props.width, props.height, props.textStyle)
    }
  }

  draw(context)

  // 本機字型第一次被指定時可能尚未完成載入；完成後補畫一次，避免 POC 停在 fallback。
  void document.fonts
    .load(canvasFont(props.textStyle), props.labels.map(label => label.text).join(''))
    .then(() => {
      if (canvasRef.value === canvas) draw(context)
    })
    .catch(() => {
      // 字型名無效時保留上方已畫出的 browser fallback，POC 不阻斷畫布。
    })
})
</script>
