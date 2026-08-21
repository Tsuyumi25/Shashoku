<template>
  <ObjectFrame
    :box="box"
    :view="view"
    :rotation="place.rotation"
    :selected="selected"
    :in-selection="inSelection"
    :locked="false"
    :handles="selected"
    :pointed="pointed"
    :pointer="pointer"
    @select="emit('select', $event)"
    @scale-start="onScaleStart"
    @scale="onScale"
    @scale-end="emit('commit')"
    @rotate-start="onRotateStart"
    @rotate="onRotate"
    @rotate-end="emit('commit')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import ObjectFrame from '@/components/ObjectFrame.vue'
import { centeredBoxOnScreen, type ViewTransform } from '@/lib/coords'
import { frameCenter, type LayerPlacement } from '@/lib/layerTransform'

/**
 * A raster layer's frame: the shared one, over the arithmetic that is paint's own.
 *
 * Its position is whole page pixels and its size is the extent of the PNG, so
 * both are read straight off the entry — no typesetter decides how big a patch
 * is. `place` is the gesture in progress and it is a preview: the layer's own
 * numbers stay whole until the release resamples the pixels into them.
 *
 * Every drawn layer wears one rather than only the selected layer, so a patch
 * can be reached by pointing at it instead of by reading down the tree. It is
 * drawn while the pointer is on it, as a text frame is: a page of outlines all
 * showing at once would be a page of rectangles over the art.
 *
 * Which is also why the box gives up the pointer. These rectangles hold their
 * own transparency, and letting the browser decide a press by whose rectangle
 * is on top would make them invisible walls. The canvas reads the pixels and
 * says which layer it found — including whether the pointer is on this one —
 * and the frame is left drawing.
 *
 * A locked layer is given no frame at all, so nothing here is ever on one — the
 * frame is what says a thing can be taken hold of.
 */
const props = defineProps<{
  entry: RasterLayerEntry
  /**
   * Where the layer's pixels are, which while it is being edited is ahead of
   * the entry's own rectangle. The canvas decides this once for the frame, the
   * reachable list and the hit test together.
   */
  frame: { x: number; y: number; w: number; h: number }
  view: ViewTransform
  selected: boolean
  inSelection: boolean
  /** The canvas's hit test says the pointer is on this layer. */
  pointed: boolean
  /** Never the whole box: only the handles of the selected layer answer. */
  pointer: 'handles' | 'none'
  place: LayerPlacement
}>()

const emit = defineEmits<{
  select: [additive: boolean]
  /** The ratio, and which fractional point of the frame the drag is pinning. */
  scale: [ratio: number, pin: { x: number; y: number }]
  /** The angle, and which fractional point of the frame the turn goes round. */
  rotate: [radians: number, pivot: { x: number; y: number }]
  /** Whichever gesture it was has been let go, and now owes the pixels a pass. */
  commit: []
}>()

/** Which point of the frame the gesture in progress is working around. */
let scalePin = { x: 0.5, y: 0.5 }
let spinPivot = { x: 0.5, y: 0.5 }

function onScaleStart(pin: { x: number; y: number }) {
  scalePin = pin
}

function onScale(ratio: number) {
  emit('scale', ratio, scalePin)
}

function onRotateStart(pivot: { x: number; y: number }) {
  spinPivot = pivot
}

function onRotate(radians: number) {
  emit('rotate', radians, spinPivot)
}

/**
 * The frame is placed from its centre, while a layer stores its top-left corner
 * — the PNG's own origin, which is what `drawImage` is given. The turn is left
 * to the frame itself, so what is measured here is the upright box.
 */
const box = computed(() => {
  const center = frameCenter(props.frame)
  const { scale, dx, dy } = props.place
  return centeredBoxOnScreen(
    { x: center.x + dx, y: center.y + dy },
    { w: props.frame.w * scale, h: props.frame.h * scale },
    props.view,
  )
})
</script>
