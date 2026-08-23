<template>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <StyleEditor
      :value="representative"
      :mixed="mixedFields"
      :effects="representativeEffects"
      @patch="onPatch"
    />

    <div class="col-span-2 mt-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
      效果
    </div>

    <StrokeEditor :effects="representativeEffects" :mixed="effectsMixed" @patch="onEffects" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'
import { sharedValue } from '@shared/batch/value'
import StyleEditor from '@/components/StyleEditor.vue'
import StrokeEditor from '@/components/appearance/StrokeEditor.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'

/**
 * What a selection of text objects can be adjusted about: how the text is set,
 * and what the object carries on top of it.
 *
 * How a disagreement is drawn is decided here rather than by whoever handed the
 * selection over. Which fields disagree is mechanical and the same question
 * everywhere; what to show for one is an interface decision, and this consumer
 * shows the field itself saying it has no single answer.
 */
const props = defineProps<{ targets: readonly AppearanceTarget<TextLayerEntry>[] }>()

const editor = useEditorStore()

const styles = computed(() => props.targets.map((t) => t.entry.style))

/**
 * One member's style, standing for the selection. Only the fields everyone
 * agrees on are ever shown from it — `mixedFields` names the rest, and the
 * editor draws those as having no single answer.
 */
const representative = computed(() => styles.value[0]!)

const mixedFields = computed(() =>
  TEXT_STYLE_FIELDS.filter((field) => sharedValue(styles.value, field).kind === 'many'),
)

/** The same standing-in, for what the nodes carry. */
const representativeEffects = computed<readonly LayerEffect[]>(
  () => props.targets[0]?.entry.effects ?? [],
)

const effectsMixed = computed(
  () => sharedValue(props.targets.map((t) => t.entry), 'effects').kind === 'many',
)

function onPatch(patch: Partial<TextStyle>) {
  editor.cmdApplyStyle(props.targets, patch)
}

function onEffects(effects: LayerEffect[]) {
  editor.cmdApplyEffects(props.targets, effects)
}
</script>
