<template>
  <div v-for="segment in segments" :key="segment.key" class="absolute inset-0" :style="styleFor(segment)">
    <StackRun
      v-if="segment.kind === 'run'"
      :nodes="segment.nodes"
      :bitmaps="bitmaps"
      :container="container"
      :view="view"
      :place="placeFor(segment)"
    />
    <PageStack
      v-else
      :nodes="segment.node.children"
      :bitmaps="bitmaps"
      :container="container"
      :view="view"
      :held="held"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import type { StackNode } from '@shared/page/stack'
import StackRun from '@/components/StackRun.vue'
import type { LayerBitmaps } from '@/composables/useLayerBitmaps'
import { stackSegments, type StackSegment } from '@/lib/stackSegments'
import type { ViewTransform } from '@/lib/coords'
import type { LayerPlacement } from '@/lib/layerTransform'

/**
 * A page's stack as elements, in the order the browser paints siblings — which
 * is the order the tree asked for. Recursive because a folder that carries
 * blending of its own has to become one picture before that blending applies,
 * and an isolated box is what the browser calls that.
 *
 * Deliberately not a compositor. The order and the blending come from
 * `pageStack`, which the export path reads too; what is here is only the
 * translation of that answer into this medium.
 */
const props = defineProps<{
  nodes: readonly StackNode[]
  /** This page's decoded layers, held above the cut so re-cutting costs nothing. */
  bitmaps: LayerBitmaps
  /** The viewport, which is what a raster canvas is sized to. */
  container: { w: number; h: number }
  view: ViewTransform
  /**
   * The layer a gesture is on and where that gesture has taken it. It is held
   * out of its run so the transform reaches it alone, and it goes back into one
   * the moment the gesture is let go.
   */
  held?: { id: string; place: LayerPlacement } | null
}>()

const segments = computed(() => stackSegments(props.nodes, props.held?.id ?? null))

function placeFor(segment: StackSegment): LayerPlacement | undefined {
  if (!props.held || segment.kind !== 'run') return undefined
  return segment.nodes[0].entry.id === props.held.id ? props.held.place : undefined
}

/**
 * The blend-mode allowlist is the CSS vocabulary on purpose, and `pageStack`
 * has already resolved away the one value CSS does not have.
 */
function asBlendMode(mode: string): CSSProperties['mixBlendMode'] {
  return mode as CSSProperties['mixBlendMode']
}

function styleFor(segment: StackSegment): CSSProperties {
  if (segment.kind === 'run') {
    // Every object's opacity is already drawn in, so only a blend mode is left
    // for CSS to apply — and it applies against the page, which is what a
    // shared canvas could not have given it.
    return segment.blendMode === 'normal' ? {} : { mixBlendMode: asBlendMode(segment.blendMode) }
  }
  const { opacity, blendMode } = segment.node
  const style: CSSProperties = { opacity }
  if (blendMode !== 'normal') style.mixBlendMode = asBlendMode(blendMode)
  // Isolating is what makes it a buffer: what is inside blends among itself
  // and meets the page only through this box.
  style.isolation = 'isolate'
  return style
}
</script>
