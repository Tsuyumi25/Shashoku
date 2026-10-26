<template>
  <label class="text-muted-foreground">描邊</label>
  <div class="flex items-center gap-1.5">
    <input
      ref="toggleEl"
      type="checkbox"
      class="h-3.5 w-3.5 accent-primary"
      :checked="stroke !== null"
      @change="onToggle($event)"
    />
    <span v-if="mixed" class="text-[10px] text-muted-foreground/60">{{ MIXED_TEXT }}</span>
    <span v-else-if="stroke === null" class="text-[10px] text-muted-foreground/60">關閉</span>
  </div>

  <template v-if="stroke !== null && !mixed">
    <span class="text-muted-foreground">寬度</span>
    <div class="flex items-center gap-1.5">
      <NumberStepper :model-value="stroke.width" label="描邊寬度" :min="1" @update:model-value="onWidth" />
      <span class="text-muted-foreground">px</span>
    </div>

    <span class="text-muted-foreground">顏色</span>
    <ColorField
      :model-value="stroke.color"
      label="描邊顏色"
      @input="onColorInput"
      @update:model-value="onColor"
    />

    <span class="text-muted-foreground">位置</span>
    <ToggleGroupRoot
      type="single"
      class="seg w-full"
      :model-value="stroke.position"
      @update:model-value="onPosition"
    >
      <ToggleGroupItem value="outside" class="seg-item">外側</ToggleGroupItem>
      <ToggleGroupItem value="center" class="seg-item">置中</ToggleGroupItem>
      <ToggleGroupItem value="inside" class="seg-item">內側</ToggleGroupItem>
    </ToggleGroupRoot>
  </template>
</template>

<script setup lang="ts">
import { computed, useTemplateRef, watchEffect } from 'vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import type { LayerEffect, StrokeEffect, StrokePosition } from '@shared/effects/types'
import { DEFAULT_STROKE } from '@shared/effects/types'
import { strokeOf, withStroke } from '@shared/effects/stroke'
import { MIXED_TEXT } from '@/lib/appearanceText'

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

const toggleEl = useTemplateRef<HTMLInputElement>('toggleEl')

// Neither on nor off, which no attribute can say — only the DOM property can.
watchEffect(() => {
  if (toggleEl.value) toggleEl.value.indeterminate = props.mixed ?? false
})

const stroke = computed<StrokeEffect | null>(() => strokeOf(props.effects))

function commit(next: StrokeEffect | null) {
  emit('patch', withStroke(props.effects, next))
}

function onToggle(e: Event) {
  commit((e.target as HTMLInputElement).checked ? { ...DEFAULT_STROKE } : null)
}

function onWidth(width: number) {
  if (stroke.value === null || width <= 0 || width === stroke.value.width) return
  commit({ ...stroke.value, width })
}

function onColorInput(color: string) {
  if (stroke.value === null) return
  emit('preview', withStroke(props.effects, { ...stroke.value, color }))
}

// No same-colour guard: after a live drag the node already reads as the new
// colour, and the commit is still owed to close the gesture.
function onColor(color: string) {
  if (stroke.value === null) return
  commit({ ...stroke.value, color })
}

function onPosition(v: unknown) {
  if (stroke.value === null) return
  if (v !== 'inside' && v !== 'center' && v !== 'outside') return
  if (v === stroke.value.position) return
  commit({ ...stroke.value, position: v as StrokePosition })
}
</script>
