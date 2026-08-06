<template>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
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
    <div class="flex items-center gap-1.5">
      <input
        type="color"
        class="h-6 w-8 cursor-pointer rounded border border-input bg-background"
        :value="value.color"
        @change="onColor($event)"
      />
      <span
        class="font-mono"
        :class="isMixed('color') ? 'text-muted-foreground/60' : 'text-muted-foreground'"
      >{{ isMixed('color') ? MIXED_TEXT : value.color }}</span>
    </div>

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
    <div class="flex items-center gap-1.5">
      <input
        type="range"
        :min="WEIGHT_MIN"
        :max="WEIGHT_MAX"
        step="0.25"
        class="h-6 min-w-0 flex-1 accent-primary"
        :value="isMixed('weightPx') ? 0 : value.weightPx"
        @input="onWeight($event)"
        @dblclick="onWeightReset"
      />
      <span
        class="w-10 shrink-0 text-right font-mono tabular-nums"
        :class="isMixed('weightPx') ? 'text-muted-foreground/60' : 'text-muted-foreground'"
      >{{ isMixed('weightPx') ? '—' : weightLabel }}</span>
    </div>

    <div class="col-span-2 mt-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
      效果
    </div>

    <label class="text-muted-foreground">描邊</label>
    <div class="flex items-center gap-1.5">
      <input
        ref="strokeToggleEl"
        type="checkbox"
        class="h-3.5 w-3.5 accent-primary"
        :checked="stroke !== null"
        @change="onToggleStroke($event)"
      />
      <span v-if="isMixed('effects')" class="text-[10px] text-muted-foreground/60">
        {{ MIXED_TEXT }}
      </span>
      <span v-else-if="stroke === null" class="text-[10px] text-muted-foreground/60">關閉</span>
    </div>

    <template v-if="stroke !== null && !isMixed('effects')">
      <label class="pl-3 text-muted-foreground">├ 寬度</label>
      <div class="flex items-center gap-1">
        <input
          type="number"
          min="1"
          step="1"
          class="h-6 w-16 rounded border border-input bg-background px-1.5"
          :value="stroke.width"
          @change="onStrokeWidth($event)"
        />
        <span class="text-muted-foreground">px</span>
      </div>

      <label class="pl-3 text-muted-foreground">├ 顏色</label>
      <div class="flex items-center gap-1.5">
        <input
          type="color"
          class="h-6 w-8 cursor-pointer rounded border border-input bg-background"
          :value="stroke.color"
          @change="onStrokeColor($event)"
        />
        <span class="font-mono text-muted-foreground">{{ stroke.color }}</span>
      </div>

      <label class="pl-3 text-muted-foreground">└ 位置</label>
      <ToggleGroupRoot
        type="single"
        class="seg w-full"
        :model-value="stroke.position"
        @update:model-value="onStrokePosition"
      >
        <ToggleGroupItem value="outside" class="seg-item">外側</ToggleGroupItem>
        <ToggleGroupItem value="center" class="seg-item">置中</ToggleGroupItem>
        <ToggleGroupItem value="inside" class="seg-item">內側</ToggleGroupItem>
      </ToggleGroupRoot>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef, watchEffect } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import type {
  StrokeEffect,
  StrokePosition,
  TextAlign,
  TextDirection,
  TextStyle,
} from '@shared/text-style/types'
import { useFontPicker } from '@/composables/useFontPicker'

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

const MIXED_TEXT = '多個值'

function isMixed(field: keyof TextStyle): boolean {
  return props.mixed?.includes(field) ?? false
}

const strokeToggleEl = useTemplateRef<HTMLInputElement>('strokeToggleEl')

// Neither on nor off, which no attribute can say — only the DOM property can.
watchEffect(() => {
  if (strokeToggleEl.value) strokeToggleEl.value.indeterminate = isMixed('effects')
})

const emit = defineEmits<{
  patch: [patch: Partial<TextStyle>]
}>()

const picker = useFontPicker()

async function openFont() {
  const chosen = await picker.open({
    current: props.value.fontFamily,
    fillColor: props.value.color,
    vertical: props.value.direction === 'vertical',
    weightPx: isMixed('weightPx') ? 0 : props.value.weightPx,
    stroke:
      stroke.value === null
        ? undefined
        : {
            width: stroke.value.width,
            color: stroke.value.color,
            position: stroke.value.position,
          },
  })
  if (chosen === null) return
  const patch: Partial<TextStyle> = {}
  // The three names travel together: a face left over from another family
  // would keep drawing that family, whatever fontFamily now says.
  if (isMixed('fontFamily') || chosen.face.postscriptName !== props.value.fontFace) {
    patch.fontFamily = chosen.face.family
    patch.fontFace = chosen.face.postscriptName
    patch.fontStyleName = chosen.face.style
  }
  // The picker carries a weight slider, so a visit can change the thickness
  // without changing the family — and then the family being the same one is
  // not a reason to drop the answer.
  if (isMixed('weightPx') || chosen.weightPx !== props.value.weightPx)
    patch.weightPx = chosen.weightPx
  if (Object.keys(patch).length > 0) emit('patch', patch)
}

const stroke = computed<StrokeEffect | null>(
  () => (props.value.effects.find((e) => e.kind === 'stroke') as StrokeEffect | undefined) ?? null,
)

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

/**
 * What each alignment is called, which follows the direction the text runs
 * while the value stored does not. Somebody setting a vertical block is asking
 * for the top, not for "start" — and the same file read the other way round has
 * to keep meaning the same thing, which is why only the wording turns.
 */
const ALIGN_LABELS: Record<TextDirection, Record<TextAlign, string>> = {
  horizontal: { start: '左', center: '中', end: '右' },
  vertical: { start: '上', center: '中', end: '下' },
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

function onColor(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (!isMixed('color') && v === props.value.color) return
  emit('patch', { color: v })
}

/**
 * Asymmetric on purpose. Thinning holds its shape as far down as the strokes
 * survive, while thickening welds neighbouring strokes into a blob early on
 * CJK, so the slider is given less room in the direction that stops behaving.
 */
const WEIGHT_MIN = -6
const WEIGHT_MAX = 3

const weightLabel = computed(() => {
  const v = props.value.weightPx
  return v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`
})

// On input rather than on change: the whole point of a slider here is watching
// the letter answer while it is being dragged.
function onWeight(e: Event) {
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw)) return
  if (!isMixed('weightPx') && raw === props.value.weightPx) return
  emit('patch', { weightPx: raw })
}

function onWeightReset() {
  if (!isMixed('weightPx') && props.value.weightPx === 0) return
  emit('patch', { weightPx: 0 })
}

function nonStrokeEffects() {
  return props.value.effects.filter((e) => e.kind !== 'stroke')
}

function commitStroke(next: StrokeEffect | null) {
  const others = nonStrokeEffects()
  emit('patch', { effects: next === null ? others : [next, ...others] })
}

function onToggleStroke(e: Event) {
  const enabled = (e.target as HTMLInputElement).checked
  if (enabled) {
    commitStroke({ kind: 'stroke', width: 3, color: '#000000', position: 'outside' })
  } else {
    commitStroke(null)
  }
}

function onStrokeWidth(e: Event) {
  if (stroke.value === null) return
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw) || raw <= 0) return
  if (raw === stroke.value.width) return
  commitStroke({ ...stroke.value, width: raw })
}

function onStrokeColor(e: Event) {
  if (stroke.value === null) return
  const v = (e.target as HTMLInputElement).value
  if (v === stroke.value.color) return
  commitStroke({ ...stroke.value, color: v })
}

function onStrokePosition(v: unknown) {
  if (stroke.value === null) return
  if (v !== 'inside' && v !== 'center' && v !== 'outside') return
  if (v === stroke.value.position) return
  commitStroke({ ...stroke.value, position: v as StrokePosition })
}
</script>
