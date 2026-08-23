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
    <label class="pl-3 text-muted-foreground">├ 寬度</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="1"
        step="1"
        class="h-6 w-16 rounded border border-input bg-background px-1.5"
        :value="stroke.width"
        @change="onWidth($event)"
      />
      <span class="text-muted-foreground">px</span>
    </div>

    <label class="pl-3 text-muted-foreground">├ 顏色</label>
    <div class="flex items-center gap-1.5">
      <input
        type="color"
        class="h-6 w-8 cursor-pointer rounded border border-input bg-background"
        :value="stroke.color"
        @change="onColor($event)"
      />
      <span class="font-mono text-muted-foreground">{{ stroke.color }}</span>
    </div>

    <label class="pl-3 text-muted-foreground">└ 位置</label>
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

const emit = defineEmits<{ patch: [effects: LayerEffect[]] }>()

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

function onWidth(e: Event) {
  if (stroke.value === null) return
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw) || raw <= 0 || raw === stroke.value.width) return
  commit({ ...stroke.value, width: raw })
}

function onColor(e: Event) {
  if (stroke.value === null) return
  const v = (e.target as HTMLInputElement).value
  if (v === stroke.value.color) return
  commit({ ...stroke.value, color: v })
}

function onPosition(v: unknown) {
  if (stroke.value === null) return
  if (v !== 'inside' && v !== 'center' && v !== 'outside') return
  if (v === stroke.value.position) return
  commit({ ...stroke.value, position: v as StrokePosition })
}
</script>
