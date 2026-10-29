<template>
  <!-- Rows only: the caller's grid holds them, beside whatever else it sets. -->
  <StrokeEditor
    :effects="representativeEffects"
    :mixed="effectsMixed"
    @preview="(effects) => editor.previewEffects(targets, effects)"
    @patch="onEffects"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import { sharedValue } from '@shared/batch/value'
import StrokeEditor from '@/components/appearance/StrokeEditor.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'

/**
 * What a selection carries on top of itself. Text and raster layers carry the
 * same effects, so one tab answers for both.
 */
const props = defineProps<{ targets: readonly AppearanceTarget[] }>()

const editor = useEditorStore()

const representativeEffects = computed<readonly LayerEffect[]>(
  () => props.targets[0]?.entry.effects ?? [],
)

const effectsMixed = computed(
  () => sharedValue(props.targets.map((t) => t.entry), 'effects').kind === 'many',
)

function onEffects(effects: LayerEffect[]) {
  editor.cmdApplyEffects(props.targets, effects)
}
</script>
