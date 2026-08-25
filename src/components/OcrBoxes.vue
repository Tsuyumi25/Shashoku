<template>
  <!--
    Every region the last trip read, drawn over the artwork.

    Apart from `OcrOverlay`, which marks the one reading a pointer rests on:
    that mark is momentary and belongs to the list's ordering, these are a
    layer somebody switched on and left on. The two would fight over one
    component's props if they shared it.

    Nothing here is an object and nothing takes a pointer — a box is a
    measurement, and letting one be clicked would make it look like something
    the page holds.
  -->
  <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
    <polygon v-for="box in drawn" :key="box.key" :points="box.points" class="ocr-box" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { contentToScreenPx, type ViewTransform } from '@/lib/coords'

const props = defineProps<{
  boxes: readonly { hash: string; x: number; y: number; w: number; h: number }[]
  view: ViewTransform
}>()

const drawn = computed(() =>
  props.boxes.map((box) => ({
    key: box.hash,
    // Corner by corner through the transform, so a rotated view turns the box
    // with the artwork instead of leaving an upright rectangle over it.
    points: [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h],
      [box.x, box.y + box.h],
    ]
      .map(([x, y]) => contentToScreenPx(x, y, props.view))
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  })),
)
</script>

<style scoped>
/* Stroked and not filled: a page has these over most of its balloons, and
   filled ones would stack into a wash that hides the artwork underneath — which
   is the thing being judged. */
.ocr-box {
  fill: none;
  stroke: oklch(0.65 0.19 285);
  stroke-width: 1.5;
}
</style>
