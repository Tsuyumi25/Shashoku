<template>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <label class="text-muted-foreground">字型</label>
    <button
      type="button"
      class="flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded border border-input bg-background px-1.5 text-left hover:border-primary"
      :title="value.fontFamily || '選擇字型'"
      @click="openFont"
    >
      <span class="min-w-0 truncate">{{ value.fontFamily || '選擇字型' }}</span>
      <ChevronDown :size="12" class="shrink-0 text-muted-foreground" />
    </button>

    <label class="text-muted-foreground">字級</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="1"
        step="1"
        class="h-6 w-16 rounded border border-input bg-background px-1.5"
        :value="value.fontSizePx"
        @change="onNumber('fontSizePx', $event)"
      />
      <span class="text-muted-foreground">px</span>
    </div>

    <label class="text-muted-foreground">方向</label>
    <ToggleGroupRoot
      type="single"
      class="seg w-full"
      :model-value="value.direction"
      @update:model-value="onDirection"
    >
      <ToggleGroupItem value="horizontal" class="seg-item">橫排</ToggleGroupItem>
      <ToggleGroupItem value="vertical" class="seg-item">直排</ToggleGroupItem>
    </ToggleGroupRoot>

    <label class="text-muted-foreground">對齊</label>
    <ToggleGroupRoot
      type="single"
      class="seg w-full"
      :model-value="value.align"
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
      <span class="font-mono text-muted-foreground">{{ value.color }}</span>
    </div>

    <label class="text-muted-foreground">行距</label>
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="1"
        step="10"
        class="h-6 w-16 rounded border border-input bg-background px-1.5"
        :value="value.leadingPercent"
        @change="onNumber('leadingPercent', $event)"
      />
      <span class="text-muted-foreground">%</span>
    </div>

    <div class="col-span-2 mt-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
      效果
    </div>

    <label class="text-muted-foreground">描邊</label>
    <div class="flex items-center gap-1.5">
      <input
        type="checkbox"
        class="h-3.5 w-3.5 accent-primary"
        :checked="stroke !== null"
        @change="onToggleStroke($event)"
      />
      <span v-if="stroke === null" class="text-[10px] text-muted-foreground/60">關閉</span>
    </div>

    <template v-if="stroke !== null">
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
import { computed } from 'vue'
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
  value: TextStyle
}>()

const emit = defineEmits<{
  patch: [patch: Partial<TextStyle>]
}>()

const picker = useFontPicker()

async function openFont() {
  const chosen = await picker.open({
    current: props.value.fontFamily,
    fillColor: props.value.color,
    vertical: props.value.direction === 'vertical',
    stroke:
      stroke.value === null
        ? undefined
        : {
            width: stroke.value.width,
            color: stroke.value.color,
            position: stroke.value.position,
          },
  })
  if (chosen === null || chosen === props.value.fontFamily) return
  emit('patch', { fontFamily: chosen })
}

const stroke = computed<StrokeEffect | null>(
  () => (props.value.effects.find((e) => e.kind === 'stroke') as StrokeEffect | undefined) ?? null,
)

function onNumber(key: 'fontSizePx' | 'leadingPercent', e: Event) {
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(raw) || raw <= 0) return
  if (raw === props.value[key]) return
  emit('patch', { [key]: raw })
}

function onDirection(v: unknown) {
  if (v !== 'horizontal' && v !== 'vertical') return
  if (v === props.value.direction) return
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
  if (v === props.value.align) return
  emit('patch', { align: v })
}

function onColor(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v === props.value.color) return
  emit('patch', { color: v })
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
