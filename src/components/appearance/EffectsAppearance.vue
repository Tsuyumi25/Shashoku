<template>
  <!-- Rows only: the caller's grid holds them, beside whatever else it sets. -->
  <StrokeEditor
    :effects="representativeEffects"
    :mixed="effectsMixed"
    :joins="joins"
    :title="title"
    @preview="(effects) => editor.previewEffects(targets, effects)"
    @patch="onEffects"
    @joins="(on) => editor.cmdSetJoins(targets, on)"
  >
    <template v-if="$slots.lead" #lead><slot name="lead" /></template>
  </StrokeEditor>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import { sharedValue } from '@shared/batch/value'
import { outerStrokeOf } from '@shared/effects/stroke'
import StrokeEditor from '@/components/appearance/StrokeEditor.vue'
import type { JoinState } from '@/components/appearance/StrokeJoinOptions.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'

/**
 * What a selection carries on top of itself. Text and raster layers carry the
 * same effects, so one tab answers for both.
 */
const props = defineProps<{ targets: readonly AppearanceTarget[]; title?: string }>()

defineSlots<{
  /** Passed through to the strokes: a pinned row above them. */
  lead?: () => unknown
}>()

const editor = useEditorStore()

const representativeEffects = computed<readonly LayerEffect[]>(
  () => props.targets[0]?.entry.effects ?? [],
)

const effectsMixed = computed(
  () => sharedValue(props.targets.map((t) => t.entry), 'effects').kind === 'many',
)

/**
 * Only text objects join; a raster's or a folder's stroke draws where the tree
 * puts it. Objects with no stroke showing have no say, and none showing at all
 * leaves nothing to join.
 */
const joins = computed<JoinState | undefined>(() => {
  if (props.targets.length === 0 || !props.targets.every((t) => t.entry.kind === 'text')) return undefined
  const says = new Set<boolean>()
  for (const t of props.targets) {
    const outer = outerStrokeOf(t.entry.effects)
    if (outer) says.add(outer.stroke.joins !== false)
  }
  if (says.size === 0) return null
  if (says.size === 2) return 'mixed'
  return says.has(true) ? 'on' : 'off'
})

function onEffects(effects: LayerEffect[]) {
  editor.cmdApplyEffects(props.targets, effects)
}
</script>
