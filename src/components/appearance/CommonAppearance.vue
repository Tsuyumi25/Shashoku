<template>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
    <label class="text-muted-foreground">模式</label>
    <select
      class="h-6 w-full min-w-0 rounded border border-input bg-background px-1"
      :value="blendMode.kind === 'one' ? blendMode.value : ''"
      @change="onBlendMode"
    >
      <option v-if="blendMode.kind === 'many'" value="">{{ MIXED_TEXT }}</option>
      <option v-for="mode in modes" :key="mode" :value="mode">{{ BLEND_LABELS[mode] }}</option>
    </select>

    <label class="text-muted-foreground">不透明</label>
    <div class="flex min-w-0 items-center gap-1.5">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        class="h-6 min-w-0 flex-1 accent-primary"
        :value="percent ?? 100"
        @input="onSlide"
        @change="onSlideEnd"
      />
      <input
        type="number"
        min="0"
        max="100"
        step="1"
        class="h-6 w-12 rounded border border-input bg-background px-1 text-right"
        :value="percent ?? ''"
        :placeholder="percent === null ? MIXED_TEXT : ''"
        @change="onTypedPercent"
      />
      <span class="text-muted-foreground">%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { BLEND_MODE_ALLOWLIST } from '@shared/page/schema'
import { sharedValue } from '@shared/batch/value'
import type { AppearanceTarget } from '@/lib/appearance'
import { MIXED_TEXT } from '@/lib/appearanceText'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * What every node has however different they are: how much of it shows, and how
 * what shows meets what is under it.
 *
 * Shown by all three consumers, which is the point of it being its own section —
 * adjusting a text object and a layer together is the one thing a mixed
 * selection can do, and it is the same two controls doing it.
 */
const props = defineProps<{ targets: readonly AppearanceTarget[] }>()

const project = useProjectStore()
const editor = useEditorStore()

/** Names as Photoshop's 繁體中文 build has them, so the vocabulary carries over. */
const BLEND_LABELS: Record<string, string> = {
  [PASS_THROUGH]: '穿透',
  normal: '正常',
  multiply: '色彩增值',
  screen: '濾色',
  overlay: '覆蓋',
  darken: '變暗',
  lighten: '變亮',
  'color-dodge': '加亮顏色',
  'color-burn': '加深顏色',
  'hard-light': '實光',
  'soft-light': '柔光',
  difference: '差異化',
  exclusion: '排除',
  hue: '色相',
  saturation: '飽和度',
  color: '顏色',
  luminosity: '明度',
}

const entries = computed<LayerEntry[]>(() => props.targets.map((t) => t.entry))

const blendMode = computed(() => sharedValue(entries.value, 'blendMode'))

const opacity = computed(() => sharedValue(entries.value, 'opacity'))

/** Null when the selection has no single answer, which the number field says. */
const percent = computed(() =>
  opacity.value.kind === 'one' ? Math.round(opacity.value.value * 100) : null,
)

// Offered only where it means something, which is also where the parser will
// take it — a folder is the only thing with a buffer of its own to decline, so
// a selection holding anything else must not be offered it.
const modes = computed(() =>
  BLEND_MODE_ALLOWLIST.filter(
    (m) => m !== PASS_THROUGH || entries.value.every((e) => e.kind === 'group'),
  ),
)

function clampPercent(raw: number): number | null {
  if (!Number.isFinite(raw)) return null
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function opacitiesNow() {
  return props.targets.map(({ pageId, entry }) => ({
    pageId,
    id: entry.id,
    opacity: entry.opacity,
  }))
}

function writeOpacity(value: number) {
  for (const { pageId, entry } of props.targets) project.setLayerOpacity(pageId, entry.id, value)
}

/**
 * Where the drag began, taken once at its first frame. Reconstructing it from
 * the current value afterwards cannot work — by then it has already moved.
 */
let slideFrom: ReturnType<typeof opacitiesNow> | null = null

function onSlide(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  if (next === null) return
  // Straight through so the page keeps up with the hand; only the release
  // below enters the undo stack.
  if (slideFrom === null) slideFrom = opacitiesNow()
  writeOpacity(next / 100)
}

function onSlideEnd(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  const from = slideFrom
  slideFrom = null
  if (next === null || from === null) return
  editor.cmdSetOpacity(from, next / 100)
}

function onTypedPercent(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  if (next === null) return
  const from = opacitiesNow()
  writeOpacity(next / 100)
  editor.cmdSetOpacity(from, next / 100)
}

function onBlendMode(e: Event) {
  const next = (e.target as HTMLSelectElement).value
  if (next === '') return
  editor.cmdSetBlendMode(
    props.targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      blendMode: entry.blendMode,
    })),
    next,
  )
}
</script>
