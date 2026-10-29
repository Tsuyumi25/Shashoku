<template>
  <button
    type="button"
    class="value-key"
    title="在左欄列出這一話用過的描邊"
    @click="valuePicker.show('stroke')"
  >
    描邊
  </button>
  <div class="flex min-w-0 items-center gap-1.5">
    <ColorField
      :model-value="shown.color"
      label="描邊顏色"
      :mixed="mixed"
      clearable
      @input="onColorInput"
      @update:model-value="onColor"
      @clear="commit(null)"
    />
    <NumberStepper
      :model-value="mixed ? null : (stroke?.width ?? 0)"
      label="描邊寬度"
      :min="0"
      :placeholder="mixed ? MIXED_TEXT : ''"
      @update:model-value="onWidth"
    />
    <span class="text-muted-foreground">px</span>
  </div>

  <span class="sub-key">位置</span>
  <ToggleGroupRoot
    type="single"
    class="seg w-full"
    :model-value="mixed || stroke === null ? undefined : stroke.position"
    @update:model-value="onPosition"
  >
    <ToggleGroupItem value="outside" class="seg-item">外側</ToggleGroupItem>
    <ToggleGroupItem value="center" class="seg-item">置中</ToggleGroupItem>
    <ToggleGroupItem value="inside" class="seg-item">內側</ToggleGroupItem>
  </ToggleGroupRoot>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import type { LayerEffect, StrokeEffect, StrokePosition } from '@shared/effects/types'
import { DEFAULT_STROKE } from '@shared/effects/types'
import { strokeOf, withStroke } from '@shared/effects/stroke'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { useValuePicker } from '@/composables/useValuePicker'

/**
 * The stroke controls, over whatever node carries them.
 *
 * Shared by the two consumers that have one, which is the whole reason effects
 * left the text style: a band grown from a letter and a band grown from a
 * layer's edge are one effect, so they are set by one set of controls rather
 * than by two that would have to be kept saying the same thing.
 *
 * Rows only — the caller owns the grid these land in, so a section can put its
 * own heading above them and its own fields below.
 *
 * Always ready to use. There is no switch: setting a colour, a position or a
 * width on an object without a stroke gives it one, and a width of zero is
 * having none.
 */
const props = defineProps<{
  /**
   * One node's list, standing for the whole selection. What it holds while
   * `mixed` is an arbitrary member's, and is never shown.
   */
  effects: readonly LayerEffect[]
  /** Whether the selection disagrees about them. */
  mixed?: boolean
}>()

const emit = defineEmits<{
  /** A step of a gesture still under way; nothing for history yet. */
  preview: [effects: LayerEffect[]]
  patch: [effects: LayerEffect[]]
}>()

const valuePicker = useValuePicker()

const stroke = computed<StrokeEffect | null>(() => strokeOf(props.effects))
/** What the controls stand on: the stroke itself, or what one would start as. */
const shown = computed<StrokeEffect>(() => stroke.value ?? DEFAULT_STROKE)

function commit(next: StrokeEffect | null) {
  emit('patch', withStroke(props.effects, next))
}

function onWidth(width: number) {
  if (width <= 0) {
    if (stroke.value !== null || props.mixed) commit(null)
    return
  }
  if (!props.mixed && width === stroke.value?.width) return
  commit({ ...shown.value, width })
}

function onColorInput(color: string) {
  emit('preview', withStroke(props.effects, { ...shown.value, color }))
}

// No same-colour guard: after a live drag the node already reads as the new
// colour, and the commit is still owed to close the gesture.
function onColor(color: string) {
  commit({ ...shown.value, color })
}

function onPosition(v: unknown) {
  if (v !== 'inside' && v !== 'center' && v !== 'outside') return
  if (!props.mixed && v === stroke.value?.position) return
  commit({ ...shown.value, position: v as StrokePosition })
}
</script>

<style scoped>
/* A part of the stroke rather than a property of its own: indented under it. */
.sub-key {
  padding-left: 0.75rem;
  color: var(--muted-foreground);
}
</style>
