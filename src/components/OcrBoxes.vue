<template>
  <!--
    Every box a turned-on route proposed, drawn over the artwork.

    Apart from `OcrOverlay`, which marks the one reading a pointer rests on:
    that mark is momentary and belongs to the list's ordering, these are a
    layer somebody switched on and left on. The two would fight over one
    component's props if they shared it.

    Nothing here is an object and nothing takes a pointer — a box is a
    measurement, and letting one be clicked would make it look like something
    the page holds.
  -->
  <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
    <polygon
      v-for="box in drawn"
      :key="box.key"
      :points="box.points"
      :class="['ocr-box', `ocr-box-${box.route}`]"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { contentToScreenPx, type ViewTransform } from '@/lib/coords'

const props = defineProps<{
  boxes: readonly { hash: string; source: string; x: number; y: number; w: number; h: number }[]
  /** Which route each source name draws as, so the colours stay stable. */
  routes: readonly string[]
  view: ViewTransform
}>()

const drawn = computed(() =>
  props.boxes.map((box) => ({
    key: box.hash,
    route: Math.max(0, props.routes.indexOf(box.source)),
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
/* Stroked and not filled: several routes propose boxes over the same balloon,
   and filled ones would stack into a wash that hides the artwork underneath —
   which is the thing being judged. */
.ocr-box {
  fill: none;
  stroke-width: 1.5;
}
.ocr-box-0 {
  stroke: oklch(0.65 0.2 25);
}
.ocr-box-1 {
  stroke: oklch(0.7 0.18 145);
}
.ocr-box-2 {
  stroke: oklch(0.75 0.17 85);
}
.ocr-box-3 {
  stroke: oklch(0.65 0.19 285);
}
</style>
