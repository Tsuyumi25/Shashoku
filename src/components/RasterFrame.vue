<template>
  <ObjectFrame
    :box="box"
    :view-rotate="view.rotate"
    :rotation="place.rotation"
    :selected="selected"
    :in-selection="inSelection"
    :locked="locked"
    :handles="selected"
    @select="emit('select', $event)"
    @drag="emit('drag', $event)"
    @drag-end="emit('commit')"
    @scale-start="onScaleStart"
    @scale="onScale"
    @scale-end="emit('commit')"
    @rotate="emit('rotate', $event)"
    @rotate-end="emit('commit')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import ObjectFrame from '@/components/ObjectFrame.vue'
import { centeredBoxOnScreen, type Displacement, type ViewTransform } from '@/lib/coords'
import { frameCenter, type LayerPlacement } from '@/lib/layerTransform'

/**
 * A raster layer's frame: the shared one, over the arithmetic that is paint's own.
 *
 * Its position is whole page pixels and its size is the extent of the PNG, so
 * both are read straight off the entry — no typesetter decides how big a patch
 * is. `place` is the gesture in progress and it is a preview: the layer's own
 * numbers stay whole until the release resamples the pixels into them.
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
  place: LayerPlacement
}>()

const emit = defineEmits<{
  select: [additive: boolean]
  drag: [d: Displacement]
  /** The ratio, and which fractional point of the frame the drag is pinning. */
  scale: [ratio: number, pin: { x: number; y: number }]
  rotate: [radians: number]
  /** Whichever gesture it was has been let go, and now owes the pixels a pass. */
  commit: []
}>()

/** Which point of the frame the corner drag is holding still. */
let scalePin = { x: 0.5, y: 0.5 }

function onScaleStart(pin: { x: number; y: number }) {
  scalePin = pin
}

function onScale(ratio: number) {
  emit('scale', ratio, scalePin)
}

/**
 * The frame is placed from its centre, while a layer stores its top-left corner
 * — the PNG's own origin, which is what `drawImage` is given. The turn is left
 * to the frame itself, so what is measured here is the upright box.
 */
const box = computed(() => {
  const center = frameCenter(props.entry)
  const { scale, dx, dy } = props.place
  return centeredBoxOnScreen(
    { x: center.x + dx, y: center.y + dy },
    { w: props.entry.w * scale, h: props.entry.h * scale },
    props.view,
  )
})
</script>
