<template>
  <ColorField
    :model-value="value.color"
    label="文字色"
    :mixed="mixed.includes('color')"
    @input="(color) => emit('preview', { color })"
    @update:model-value="(color) => emit('patch', { color })"
  />
  <NumberStepper
    :model-value="mixed.includes('weightPx') ? null : value.weightPx"
    label="字粗"
    :min="WEIGHT_MIN"
    :max="WEIGHT_MAX"
    :step="0.25"
    :placeholder="mixed.includes('weightPx') ? MIXED_TEXT : ''"
    @update:model-value="onWeight"
  />
  <span class="text-muted-foreground">px</span>
  <button
    type="button"
    class="h-6 rounded border border-input px-1.5 hover:border-primary disabled:opacity-40 disabled:hover:border-input"
    :disabled="!mixed.includes('weightPx') && value.weightPx === 0"
    title="字粗回到 0"
    @click="onWeight(0)"
  >0</button>
</template>

<script setup lang="ts">
import type { TextStyle } from '@shared/text-style/types'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import { MIXED_TEXT } from '@/lib/appearanceText'

/**
 * The letters themselves, as the first row of what is laid around them: their
 * colour, alpha included, and how far their edge is moved. Pinned at the head
 * of the strokes because the first stroke is measured off exactly this edge.
 */
const props = defineProps<{
  value: Pick<TextStyle, 'color' | 'weightPx'>
  /** Which of the two the selection disagrees on. */
  mixed: readonly (keyof TextStyle)[]
}>()

const emit = defineEmits<{
  /** A step of a gesture still under way; nothing for history yet. */
  preview: [patch: Partial<TextStyle>]
  patch: [patch: Partial<TextStyle>]
}>()

/**
 * Asymmetric on purpose. Thinning holds its shape as far down as the strokes
 * survive, while thickening welds neighbouring strokes into a blob early on
 * CJK, so the control is given less room in the direction that stops behaving.
 */
const WEIGHT_MIN = -6
const WEIGHT_MAX = 3

function onWeight(px: number) {
  if (!props.mixed.includes('weightPx') && px === props.value.weightPx) return
  emit('patch', { weightPx: px })
}
</script>
