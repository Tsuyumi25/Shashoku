<template>
  <div class="flex flex-col gap-2 text-xs">
    <div class="flex flex-wrap gap-1" role="group" aria-label="特效">
      <button
        type="button"
        class="h-6 rounded border px-2"
        :class="
          glowState === 'off'
            ? 'border-input text-muted-foreground hover:border-primary hover:text-foreground'
            : 'border-primary text-foreground'
        "
        :aria-pressed="glowState === 'on' ? 'true' : glowState === 'mixed' ? 'mixed' : 'false'"
        :title="glowState === 'mixed' ? '光暈：選取裡有的有、有的沒有，按一下全部打開' : '光暈'"
        @click="toggleGlow"
      >
        光暈{{ glowState === 'mixed' ? '（部分）' : '' }}
      </button>
    </div>

    <div v-if="glowState !== 'off'" class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 border-t border-border pt-2">
      <span class="text-muted-foreground">模式</span>
      <select
        class="col-span-2 h-6 w-full min-w-0 rounded border border-input bg-background px-1"
        title="光暈怎麼跟底下的東西混合"
        :value="blendMixed ? '' : shownGlow.blendMode"
        @change="onBlend"
      >
        <option v-if="blendMixed" value="">{{ MIXED_TEXT }}</option>
        <option v-for="mode in GLOW_BLEND_MODES" :key="mode" :value="mode">{{ BLEND_LABELS[mode] }}</option>
      </select>
      <span class="text-muted-foreground">顏色</span>
      <ColorField
        :model-value="shownGlow.color"
        label="光暈顏色"
        :mixed="colorMixed"
        @input="(color) => editor.previewEffectsEach(targets, glowEdit({ color }))"
        @update:model-value="(color) => editor.cmdEditEffectsEach(targets, glowEdit({ color }))"
      />
      <span />
      <span class="text-muted-foreground">展開</span>
      <NumberStepper
        :model-value="spreadMixed ? null : shownGlow.spread"
        label="光暈展開"
        title="大小裡有多少先撐成實心再模糊：0% 從字的邊緣就開始淡，100% 是一圈硬邊"
        :min="0"
        :max="100"
        :placeholder="spreadMixed ? MIXED_TEXT : ''"
        @update:model-value="(spread: number) => editor.cmdEditEffectsEach(targets, glowEdit({ spread }))"
      />
      <span class="text-muted-foreground">%</span>
      <span class="text-muted-foreground">大小</span>
      <NumberStepper
        :model-value="sizeMixed ? null : shownGlow.size"
        label="光暈大小"
        :min="0"
        :max="GLOW_SIZE_MAX"
        :placeholder="sizeMixed ? MIXED_TEXT : ''"
        @update:model-value="(size: number) => editor.cmdEditEffectsEach(targets, glowEdit({ size }))"
      />
      <span class="text-muted-foreground">px</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GlowEffect, LayerEffect } from '@shared/effects/types'
import { DEFAULT_GLOW } from '@shared/effects/types'
import { glowOf, withGlow } from '@shared/effects/glow'
import { BLEND_MODE_ALLOWLIST, PASS_THROUGH } from '@shared/page/types'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import type { AppearanceTarget } from '@/lib/appearance'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { BLEND_LABELS } from '@/lib/blendLabels'
import { useEditorStore } from '@/stores/editorStore'

/**
 * The effects that are not part of every label: switched on from the row of
 * buttons at the top, and set underneath once on. Each edit goes to each node's
 * own list, so a selection keeps whatever strokes its members disagree on.
 */
const props = defineProps<{ targets: readonly AppearanceTarget[] }>()

const editor = useEditorStore()

const GLOW_SIZE_MAX = 200

/** A halo has no contents of its own to pass through to. */
const GLOW_BLEND_MODES = BLEND_MODE_ALLOWLIST.filter((mode) => mode !== PASS_THROUGH)

const glows = computed(() => props.targets.map((t) => glowOf(t.entry.effects)))

const glowState = computed<'on' | 'off' | 'mixed'>(() => {
  const on = glows.value.filter((g) => g !== null).length
  if (on === 0) return 'off'
  return on === glows.value.length ? 'on' : 'mixed'
})

const present = computed(() => glows.value.filter((g): g is GlowEffect => g !== null))

const shownGlow = computed<GlowEffect>(() => present.value[0] ?? DEFAULT_GLOW)

const colorMixed = computed(() => new Set(present.value.map((g) => g.color.toLowerCase())).size > 1)
const sizeMixed = computed(() => new Set(present.value.map((g) => g.size)).size > 1)
const spreadMixed = computed(() => new Set(present.value.map((g) => g.spread)).size > 1)
const blendMixed = computed(() => new Set(present.value.map((g) => g.blendMode)).size > 1)

function onBlend(e: Event) {
  const blendMode = (e.target as HTMLSelectElement).value
  if (blendMode !== '') editor.cmdEditEffectsEach(props.targets, glowEdit({ blendMode }))
}

/** Mixed turns on for everyone, which is what a press on a half-lit button reads as. */
function toggleGlow() {
  const turnOn = glowState.value !== 'on'
  editor.cmdEditEffectsEach(props.targets, (effects) =>
    withGlow(effects, turnOn ? (glowOf(effects) ?? { ...DEFAULT_GLOW }) : null),
  )
}

/** A change to the halos that are there; a node without one is left without one. */
function glowEdit(patch: Partial<Omit<GlowEffect, 'kind'>>) {
  return (effects: readonly LayerEffect[]): LayerEffect[] => {
    const glow = glowOf(effects)
    return glow === null ? [...effects] : withGlow(effects, { ...glow, ...patch })
  }
}
</script>
