<template>
  <label class="text-muted-foreground">字型</label>
  <button
    type="button"
    class="flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded border border-input bg-background px-1.5 text-left hover:border-primary"
    :title="isMixed('fontFamily') ? MIXED_TEXT : value.fontFamily || '選擇字型'"
    @click="openFont"
  >
    <span
      class="min-w-0 truncate"
      :class="isMixed('fontFamily') && 'text-muted-foreground/60'"
    >{{ isMixed('fontFamily') ? MIXED_TEXT : value.fontFamily || '選擇字型' }}</span>
    <ChevronDown :size="12" class="shrink-0 text-muted-foreground" />
  </button>

  <template v-if="weightFaces">
    <label class="text-muted-foreground">字重</label>
    <div class="flex h-6 w-full items-center gap-1">
      <button
        type="button"
        class="h-full w-7 shrink-0 rounded border border-input bg-background hover:bg-secondary"
        title="上一個字重"
        @click="cycleWeight(-1)"
      >
        &lt;
      </button>
      <span
        class="min-w-0 flex-1 truncate text-center"
        :class="isMixed('fontFace') ? 'text-muted-foreground/60' : 'text-muted-foreground'"
        :title="weightText"
      >{{ weightText }}</span>
      <button
        type="button"
        class="h-full w-7 shrink-0 rounded border border-input bg-background hover:bg-secondary"
        title="下一個字重"
        @click="cycleWeight(1)"
      >
        &gt;
      </button>
    </div>
  </template>

  <label class="text-muted-foreground">字級</label>
  <div class="flex items-center gap-1">
    <input
      type="number"
      min="1"
      step="1"
      class="h-6 w-16 rounded border border-input bg-background px-1.5"
      :value="isMixed('fontSizePx') ? '' : value.fontSizePx"
      :placeholder="isMixed('fontSizePx') ? MIXED_TEXT : ''"
      @change="onNumber('fontSizePx', $event)"
    />
    <span class="text-muted-foreground">px</span>
  </div>

  <label class="text-muted-foreground">方向</label>
  <ToggleGroupRoot
    type="single"
    class="seg w-full"
    :model-value="isMixed('direction') ? undefined : value.direction"
    @update:model-value="onDirection"
  >
    <ToggleGroupItem value="horizontal" class="seg-item">橫排</ToggleGroupItem>
    <ToggleGroupItem value="vertical" class="seg-item">直排</ToggleGroupItem>
  </ToggleGroupRoot>

  <label class="text-muted-foreground">對齊</label>
  <ToggleGroupRoot
    type="single"
    class="seg w-full"
    :model-value="isMixed('align') ? undefined : value.align"
    @update:model-value="onAlign"
  >
    <ToggleGroupItem
      v-for="choice in alignChoices"
      :key="choice.value"
      :value="choice.value"
      class="seg-item"
    >
      {{ choice.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>

  <label class="text-muted-foreground">文字色</label>
  <ColorField
    :model-value="value.color"
    label="文字色"
    :mixed="isMixed('color')"
    @input="(color) => emit('preview', { color })"
    @update:model-value="(color) => emit('patch', { color })"
  />

  <label class="text-muted-foreground">行距</label>
  <div class="flex items-center gap-1">
    <input
      type="number"
      min="1"
      step="10"
      class="h-6 w-16 rounded border border-input bg-background px-1.5"
      :value="isMixed('leadingPercent') ? '' : value.leadingPercent"
      :placeholder="isMixed('leadingPercent') ? MIXED_TEXT : ''"
      @change="onNumber('leadingPercent', $event)"
    />
    <span class="text-muted-foreground">%</span>
  </div>

  <label class="text-muted-foreground">字粗</label>
  <div class="flex items-center gap-1">
    <NumberStepper
      :model-value="isMixed('weightPx') ? null : value.weightPx"
      label="字粗"
      :min="WEIGHT_MIN"
      :max="WEIGHT_MAX"
      :step="0.25"
      :placeholder="isMixed('weightPx') ? MIXED_TEXT : ''"
      @update:model-value="onWeight"
    />
    <span class="text-muted-foreground">px</span>
    <button
      type="button"
      class="ml-auto h-6 rounded border border-input px-1.5 hover:border-primary disabled:opacity-40 disabled:hover:border-input"
      :disabled="!isMixed('weightPx') && value.weightPx === 0"
      title="字粗回到 0"
      @click="onWeight(0)"
    >0</button>
  </div>

  <label class="text-muted-foreground">水平</label>
  <div class="flex items-center gap-1">
    <NumberStepper
      :model-value="isMixed('scaleXPercent') ? null : value.scaleXPercent"
      label="水平縮放"
      :min="MIN_SCALE_PERCENT"
      :max="MAX_SCALE_PERCENT"
      :step="5"
      :placeholder="isMixed('scaleXPercent') ? MIXED_TEXT : ''"
      @update:model-value="(v: number) => onScalePercent('scaleXPercent', v)"
    />
    <span class="text-muted-foreground">%</span>
  </div>

  <label class="text-muted-foreground">垂直</label>
  <div class="flex items-center gap-1">
    <NumberStepper
      :model-value="isMixed('scaleYPercent') ? null : value.scaleYPercent"
      label="垂直縮放"
      :min="MIN_SCALE_PERCENT"
      :max="MAX_SCALE_PERCENT"
      :step="5"
      :placeholder="isMixed('scaleYPercent') ? MIXED_TEXT : ''"
      @update:model-value="(v: number) => onScalePercent('scaleYPercent', v)"
    />
    <span class="text-muted-foreground">%</span>
    <button
      type="button"
      class="ml-auto h-6 rounded border border-input px-1.5 hover:border-primary disabled:opacity-40 disabled:hover:border-input"
      :disabled="!scaled"
      title="水平與垂直都回到 100%"
      @click="onScaleReset"
    >100%</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import {
  MAX_SCALE_PERCENT,
  MIN_SCALE_PERCENT,
  type TextStyle,
} from '@shared/text-style/types'
import ColorField from '@/components/ColorField.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { catalogByFamily, representativeOf } from '@/lib/fontCatalog'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { ALIGN_LABELS } from '@/lib/textStyleFields'

/**
 * How the text is set — everything about typesetting and nothing about what is
 * laid on top of it, which a node carries and `StrokeEditor` adjusts.
 *
 * Rows only: the caller owns the grid these land in, so a section can put its
 * own heading above them and another consumer's controls below.
 *
 * Each control may carry a strip of what the project already sets for that
 * field. It hangs here rather than in a panel of its own because a candidate
 * and the control it would fill are the same field asked twice — apart, the two
 * of them are a value to read and a value to type; together, one is the other's
 * answer.
 */
const props = defineProps<{
  /**
   * One style standing for the whole selection. Fields named in `mixed` are
   * the ones the selection disagrees on, and what `value` holds for those is
   * an arbitrary member's — never shown, never sent back untouched.
   */
  value: TextStyle
  /**
   * Which fields the selection disagrees on. A control here shows that it has
   * no single answer rather than picking one, because a panel that showed 24
   * for a selection also holding 48s would turn a glance into an edit.
   */
  mixed?: readonly (keyof TextStyle)[]
}>()

function isMixed(field: keyof TextStyle): boolean {
  return props.mixed?.includes(field) ?? false
}

/**
 * The faces the weight row can walk. Null hides the row: a family the
 * selection disagrees on has no list to walk, a family this machine lacks has
 * nothing to switch to, and a single-weight family has nowhere to go.
 */
const weightFaces = computed(() => {
  if (isMixed('fontFamily')) return null
  const faces = catalogByFamily.value.get(props.value.fontFamily)
  return faces && faces.length > 1 ? faces : null
})

/**
 * Where the walk stands. A face this machine lacks — or a selection that
 * disagrees — stands at the family's representative, so a step lands
 * everywhere the same and one press gives the whole selection one weight.
 */
const weightAt = computed(() => {
  const faces = weightFaces.value
  if (!faces) return -1
  if (!isMixed('fontFace')) {
    const at = faces.findIndex((f) => f.postscriptName === props.value.fontFace)
    if (at >= 0) return at
  }
  const representative = representativeOf(faces)
  return representative ? faces.indexOf(representative) : 0
})

const weightText = computed(() => {
  const faces = weightFaces.value
  if (!faces) return ''
  if (isMixed('fontFace')) return MIXED_TEXT
  const face = faces[weightAt.value]!
  return `${face.style || face.postscriptName} · ${weightAt.value + 1}/${faces.length}`
})

function cycleWeight(step: number) {
  const faces = weightFaces.value
  if (!faces) return
  const next = faces[(weightAt.value + step + faces.length) % faces.length]!
  emit('patch', {
    fontFamily: next.family,
    fontFace: next.postscriptName,
    fontStyleName: next.style,
  })
}

const emit = defineEmits<{
  /** A step of a gesture still under way; nothing for history yet. */
  preview: [patch: Partial<TextStyle>]
  patch: [patch: Partial<TextStyle>]
}>()

const picker = useFontPicker()

function openFont() {
  picker.show()
}

function onNumber(key: 'fontSizePx' | 'leadingPercent', e: Event) {
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw) || raw <= 0) return
  if (!isMixed(key) && raw === props.value[key]) return
  emit('patch', { [key]: raw })
}

function onDirection(v: unknown) {
  if (v !== 'horizontal' && v !== 'vertical') return
  if (!isMixed('direction') && v === props.value.direction) return
  emit('patch', { direction: v })
}

const alignChoices = computed(() =>
  (['start', 'center', 'end'] as const).map((value) => ({
    value,
    label: ALIGN_LABELS[props.value.direction][value],
  })),
)

function onAlign(v: unknown) {
  if (v !== 'start' && v !== 'center' && v !== 'end') return
  if (!isMixed('align') && v === props.value.align) return
  emit('patch', { align: v })
}

/**
 * Asymmetric on purpose. Thinning holds its shape as far down as the strokes
 * survive, while thickening welds neighbouring strokes into a blob early on
 * CJK, so the control is given less room in the direction that stops behaving.
 */
const WEIGHT_MIN = -6
const WEIGHT_MAX = 3

function onWeight(px: number) {
  if (!isMixed('weightPx') && px === props.value.weightPx) return
  emit('patch', { weightPx: px })
}

function onScalePercent(key: 'scaleXPercent' | 'scaleYPercent', raw: number) {
  if (!isMixed(key) && raw === props.value[key]) return
  emit('patch', { [key]: raw })
}

/** Whether there is anything to put back — a selection that disagrees always has. */
const scaled = computed(
  () =>
    isMixed('scaleXPercent') ||
    isMixed('scaleYPercent') ||
    props.value.scaleXPercent !== 100 ||
    props.value.scaleYPercent !== 100,
)

/**
 * Both at once, in one step: the pair is what a squashed object is, and putting
 * one axis back is a state nobody asked for — which is the hole this feature
 * exists to close, since a transform leaves nothing to press at all.
 */
function onScaleReset() {
  emit('patch', { scaleXPercent: 100, scaleYPercent: 100 })
}

</script>
