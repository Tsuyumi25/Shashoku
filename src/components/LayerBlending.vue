<template>
  <div
    class="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1.5 text-xs select-none"
    :class="target === null && 'opacity-40'"
  >
    <label class="text-muted-foreground">模式</label>
    <select
      class="h-6 w-full min-w-0 rounded border border-input bg-background px-1 disabled:cursor-not-allowed"
      :value="target?.blendMode ?? 'normal'"
      :disabled="target === null"
      @change="onBlendMode"
    >
      <option v-for="mode in modes" :key="mode" :value="mode">{{ BLEND_LABELS[mode] }}</option>
    </select>

    <label class="text-muted-foreground">不透明</label>
    <div class="flex min-w-0 items-center gap-1.5">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        class="h-6 min-w-0 flex-1 accent-primary disabled:cursor-not-allowed"
        :value="percent"
        :disabled="target === null"
        @input="onSlide"
        @change="onSlideEnd"
      />
      <input
        type="number"
        min="0"
        max="100"
        step="1"
        class="h-6 w-12 rounded border border-input bg-background px-1 text-right"
        :value="percent"
        :disabled="target === null"
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
import { findEntry } from '@shared/page/tree'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The two controls every layer panel has, over the tree they act on.
 *
 * They read the cursor — whichever row was touched last — and write to
 * everything selected, which is how Photoshop's do and what keeps dimming five
 * layers one act rather than five. Always on screen, greyed when there is
 * nothing to act on: a strip that came and went would make the tree jump.
 */
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

/** What the controls show. The cursor is the row touched last, as everywhere else. */
const target = computed<LayerEntry | null>(() => {
  const page = editor.currentFilename
  const id = editor.cursorId
  if (page === null || id === null) return null
  const file = project.fileByName(page)
  return file ? (findEntry(file.page.layers, id) ?? null) : null
})

// Offered only where it means something, which is also where the parser will
// take it — a folder is the only thing with a buffer of its own to decline.
const modes = computed(() =>
  BLEND_MODE_ALLOWLIST.filter((m) => m !== PASS_THROUGH || target.value?.kind === 'group'),
)

const percent = computed(() => Math.round((target.value?.opacity ?? 1) * 100))

function affected(): LayerEntry[] {
  return editor.layersToBlend()
}

function clampPercent(raw: number): number | null {
  if (!Number.isFinite(raw)) return null
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/**
 * Where the drag began, taken once at its first frame. Reconstructing it from
 * the current value afterwards cannot work — by then it has already moved.
 */
let slideFrom: Map<string, number> | null = null

function writeOpacity(value: number) {
  const page = editor.currentFilename
  if (page === null) return
  for (const entry of affected()) project.setLayerOpacity(page, entry.id, value)
}

function onSlide(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  if (next === null) return
  // Straight through so the page keeps up with the hand; only the release
  // below enters the undo stack.
  if (slideFrom === null) slideFrom = new Map(affected().map((entry) => [entry.id, entry.opacity]))
  writeOpacity(next / 100)
}

function onSlideEnd(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  const from = slideFrom
  slideFrom = null
  const page = editor.currentFilename
  if (next === null || from === null || page === null) return
  editor.cmdSetLayerOpacity(page, from, next / 100)
}

function onTypedPercent(e: Event) {
  const next = clampPercent((e.target as HTMLInputElement).valueAsNumber)
  const page = editor.currentFilename
  if (next === null || page === null) return
  const from = new Map(affected().map((entry) => [entry.id, entry.opacity]))
  writeOpacity(next / 100)
  editor.cmdSetLayerOpacity(page, from, next / 100)
}

function onBlendMode(e: Event) {
  const next = (e.target as HTMLSelectElement).value
  const page = editor.currentFilename
  if (page === null) return
  editor.cmdSetLayerBlendMode(
    page,
    new Map(affected().map((entry) => [entry.id, entry.blendMode])),
    next,
  )
}
</script>
