<template>
  <ObjectFrame
    :box="box"
    :view-rotate="view.rotate"
    :rotation="0"
    :selected="selected"
    :in-selection="inSelection"
    :locked="locked"
    :handles="false"
    @select="emit('select', $event)"
    @drag="emit('drag', $event)"
    @drag-end="emit('dragEnd', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import ObjectFrame from '@/components/ObjectFrame.vue'
import { centeredBoxOnScreen, type Displacement, type ViewTransform } from '@/lib/coords'

/**
 * A raster layer's frame: the shared one, over the arithmetic that is paint's own.
 *
 * Its position is whole page pixels and its size is the extent of the PNG, so
 * both are read straight off the entry — no typesetter decides how big a patch
 * is. `offset` is the drag in progress, in screen pixels, and it is a preview:
 * the layer's own numbers stay whole until the release lands them.
 *
 * Unlike a text object this frame appears only while the layer is selected. A
 * text frame is the translation's own outline and marks the work; this one is
 * only a handle, and an erase patch's handle is a large, mostly transparent
 * rectangle — a page of them would be a page of invisible walls over the art.
 */
const props = defineProps<{
  entry: RasterLayerEntry
  view: ViewTransform
  selected: boolean
  inSelection: boolean
  locked: boolean
  offset: Displacement
}>()

const emit = defineEmits<{
  select: [additive: boolean]
  drag: [d: Displacement]
  dragEnd: [d: Displacement]
}>()

/**
 * The frame is placed from its centre, while a layer stores its top-left corner
 * — the PNG's own origin, which is what `drawImage` is given.
 */
const box = computed(() => {
  const { x, y, w, h } = props.entry
  const placed = centeredBoxOnScreen({ x: x + w / 2, y: y + h / 2 }, { w, h }, props.view)
  return {
    ...placed,
    centerX: placed.centerX + props.offset.dx,
    centerY: placed.centerY + props.offset.dy,
  }
})
</script>
