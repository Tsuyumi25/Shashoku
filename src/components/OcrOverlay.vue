<template>
  <!--
    Where the reading under the pointer was read, and nothing else.

    What a model found is not something the artwork has to carry. The candidates
    already say what was read and how sure each recognizer was, in a list that
    can actually be read; repeating all of it as boxes and captions buried the
    one thing on screen that cannot be shown anywhere else.

    This mark stays because it answers what the candidates cannot: that list is
    ordered by where each reading was taken, and without this the key it is
    ordered by is invisible.
  -->
  <svg
    v-if="points"
    class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  >
    <polygon :points="points" class="ocr-pointed" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OcrCrop } from '@shared/ocr/types'
import { contentToScreenPx, type ViewTransform } from '@/lib/coords'

const props = defineProps<{
  /** The reading the pointer is over in the list, if any. */
  pointedBox: OcrCrop | null
  view: ViewTransform
}>()

const points = computed(() => {
  const box = props.pointedBox
  if (!box) return null
  // Four corners each through the transform rather than a rect placed by its
  // origin, so a rotated view turns the mark with the artwork instead of
  // leaving an upright rectangle floating over slanted panels.
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ]
    .map(([x, y]) => contentToScreenPx(x, y, props.view))
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
})
</script>

<style scoped>
/* Filled as well as stroked: it has to be findable at a glance on a page of
   line art, and it is up only while a pointer is being held somewhere. */
.ocr-pointed {
  fill: color-mix(in srgb, oklch(0.62 0.19 265) 18%, transparent);
  stroke: oklch(0.62 0.19 265);
  stroke-width: 2;
}
</style>
