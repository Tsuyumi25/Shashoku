<template>
  <div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 border-t border-border pt-2">
    <span class="text-muted-foreground">間距</span>
    <div class="flex min-w-0 items-center gap-1.5">
      <input
        type="range"
        :min="SPACING_MIN"
        :max="SPACING_MAX"
        step="0.5"
        class="h-6 min-w-0 flex-1 accent-primary"
        title="相鄰兩個網點中心隔幾個頁面像素，看著畫面拖到跟原圖對上"
        :value="shown.spacing"
        @input="(e) => preview({ spacing: valueOf(e) })"
        @change="(e) => commit({ spacing: valueOf(e) })"
      />
      <NumberStepper
        :model-value="spacingMixed ? null : shown.spacing"
        label="網點間距"
        :min="SPACING_MIN"
        :step="0.5"
        :placeholder="spacingMixed ? MIXED_TEXT : ''"
        @update:model-value="(spacing: number) => commit({ spacing })"
      />
    </div>
    <span class="text-muted-foreground">px</span>

    <span class="text-muted-foreground">角度</span>
    <NumberStepper
      :model-value="angleMixed ? null : shown.angle"
      label="網點角度"
      :min="-180"
      :max="180"
      :placeholder="angleMixed ? MIXED_TEXT : ''"
      @update:model-value="(angle: number) => commit({ angle })"
    />
    <span class="text-muted-foreground">°</span>

    <span class="text-muted-foreground">濃度</span>
    <select
      class="h-6 w-full min-w-0 rounded border border-input bg-background px-1"
      :value="densityMixed ? '' : shown.density === 'image' ? 'image' : 'fixed'"
      @change="onDensitySource"
    >
      <option v-if="densityMixed" value="">{{ MIXED_TEXT }}</option>
      <option value="image">跟著原圖深淺</option>
      <option value="fixed">指定</option>
    </select>
    <span />

    <template v-if="!densityMixed && shown.density !== 'image'">
      <span />
      <div class="flex min-w-0 items-center gap-1.5">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          class="h-6 min-w-0 flex-1 accent-primary"
          :value="shown.density"
          @input="(e) => preview({ density: valueOf(e) })"
          @change="(e) => commit({ density: valueOf(e) })"
        />
        <NumberStepper
          :model-value="shown.density"
          label="網點濃度"
          :min="0"
          :max="100"
          @update:model-value="(density: number) => commit({ density })"
        />
      </div>
      <span class="text-muted-foreground">%</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEffect, ToneEffect } from '@shared/effects/types'
import { DEFAULT_TONE } from '@shared/effects/types'
import { toneOf, withTone } from '@shared/effects/tone'
import NumberStepper from '@/components/NumberStepper.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { useEditorStore } from '@/stores/editorStore'

/**
 * The screentone of a selection that has one. Spacing is what gets matched by
 * eye against the dots already on the artwork, so it is a slider that shows the
 * page as it moves and writes once on release.
 */
const props = defineProps<{ targets: readonly AppearanceTarget[] }>()

const editor = useEditorStore()

/** Below two pixels a dot is smaller than the pixel it would have to be drawn in. */
const SPACING_MIN = 2
const SPACING_MAX = 40

const present = computed(() =>
  props.targets.map((t) => toneOf(t.entry.effects)).filter((t): t is ToneEffect => t !== null),
)

const shown = computed<ToneEffect>(() => present.value[0] ?? DEFAULT_TONE)

const spacingMixed = computed(() => new Set(present.value.map((t) => t.spacing)).size > 1)
const angleMixed = computed(() => new Set(present.value.map((t) => t.angle)).size > 1)
const densityMixed = computed(() => new Set(present.value.map((t) => t.density)).size > 1)

function valueOf(e: Event): number {
  return Number((e.target as HTMLInputElement).value)
}

/** A change to the screentones that are there; a node without one is left without one. */
function toneEdit(patch: Partial<Omit<ToneEffect, 'kind'>>) {
  return (effects: readonly LayerEffect[]): LayerEffect[] => {
    const tone = toneOf(effects)
    return tone === null ? [...effects] : withTone(effects, { ...tone, ...patch })
  }
}

function preview(patch: Partial<Omit<ToneEffect, 'kind'>>) {
  editor.previewEffectsEach(props.targets, toneEdit(patch))
}

function commit(patch: Partial<Omit<ToneEffect, 'kind'>>) {
  editor.cmdEditEffectsEach(props.targets, toneEdit(patch))
}

/** Switching to a fixed density starts from half, the middle of the slider. */
function onDensitySource(e: Event) {
  const source = (e.target as HTMLSelectElement).value
  if (source === 'image') commit({ density: 'image' })
  else if (source === 'fixed') commit({ density: 50 })
}
</script>
