<template>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <div class="col-span-2 text-[10px] text-muted-foreground">效果</div>

    <StrokeEditor :effects="representativeEffects" :mixed="effectsMixed" @patch="onEffects" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import type { RasterLayerEntry } from '@shared/page/types'
import { sharedValue } from '@shared/batch/value'
import StrokeEditor from '@/components/appearance/StrokeEditor.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'

/**
 * What a selection of raster layers can be adjusted about.
 *
 * The second consumer, and the reason there is an outer layer at all: an
 * abstraction with one user is a panel wearing a hat, and only a second one
 * that really differs shows whether the split was made in the right place.
 */
const props = defineProps<{ targets: readonly AppearanceTarget<RasterLayerEntry>[] }>()

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
