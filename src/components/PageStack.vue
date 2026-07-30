<template>
  <div v-for="segment in segments" :key="segment.key" class="absolute inset-0" :style="styleFor(segment)">
    <RasterRun
      v-if="segment.kind === 'rasters'"
      :nodes="segment.nodes"
      :layers-dir="layersDir"
      :container="container"
      :view="view"
      :place="placeFor(segment)"
    />
    <LabelText
      v-else-if="segment.kind === 'text'"
      :text="textOf(segment.node.entry)"
      :text-style="styleOf(segment.node.entry)"
      :x="segment.node.entry.x"
      :y="segment.node.entry.y"
      :rotation="segment.node.entry.rotation"
      :natural="natural"
      :view="view"
    />
    <PageStack
      v-else
      :nodes="segment.node.children"
      :layers-dir="layersDir"
      :container="container"
      :natural="natural"
      :view="view"
      :groups="groups"
      :default-style="defaultStyle"
      :held="held"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import type { StyleGroup } from '@shared/project/types'
import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import type { StackNode } from '@shared/page/stack'
import { textOf } from '@shared/page/text'
import LabelText from '@/components/LabelText.vue'
import RasterRun from '@/components/RasterRun.vue'
import { stackSegments, type StackSegment } from '@/lib/stackSegments'
import type { ViewTransform } from '@/lib/coords'
import type { LayerPlacement } from '@/lib/layerTransform'
import { resolveTextStyle } from '@/lib/textStyle'

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
  /** Where this page's layer files live. */
  layersDir: string
  /** The viewport, which is what a raster canvas is sized to. */
  container: { w: number; h: number }
  /** The raw page's own pixel size, which label anchors are a fraction of. */
  natural: { w: number; h: number }
  view: ViewTransform
  groups: readonly StyleGroup[]
  defaultStyle: TextStyle
  /**
   * The layer a gesture is on and where that gesture has taken it. It is held
   * out of its run so the transform reaches it alone, and it goes back into
   * one when nothing is selected there any more.
   */
  held?: { id: string; place: LayerPlacement } | null
}>()

const segments = computed(() => stackSegments(props.nodes, props.held?.id ?? null))

function placeFor(segment: StackSegment): LayerPlacement | undefined {
  if (!props.held || segment.kind !== 'rasters') return undefined
  return segment.nodes[0].entry.id === props.held.id ? props.held.place : undefined
}

function styleOf(entry: TextLayerEntry): TextStyle {
  return resolveTextStyle(entry, props.groups, props.defaultStyle)
}

/**
 * The blend-mode allowlist is the CSS vocabulary on purpose, and `pageStack`
 * has already resolved away the one value CSS does not have.
 */
function asBlendMode(mode: string): CSSProperties['mixBlendMode'] {
  return mode as CSSProperties['mixBlendMode']
}

function styleFor(segment: StackSegment): CSSProperties {
  if (segment.kind === 'rasters') {
    // Each layer's opacity is already drawn in, so only a blend mode is left
    // for CSS to apply — and it applies against the page, which is what a
    // shared canvas could not have given it.
    return segment.blendMode === 'normal' ? {} : { mixBlendMode: asBlendMode(segment.blendMode) }
  }
  const { opacity, blendMode } = segment.node
  const style: CSSProperties = { opacity }
  if (blendMode !== 'normal') style.mixBlendMode = asBlendMode(blendMode)
  // Isolating is the buffer: what is inside blends among itself and meets the
  // page only through this box.
  if (segment.kind === 'buffer') style.isolation = 'isolate'
  return style
}
</script>
