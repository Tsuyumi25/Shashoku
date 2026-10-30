<template>
  <div class="flex h-full min-h-0 flex-col bg-background text-sm">
    <div class="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <input
        v-model="search"
        type="search"
        spellcheck="false"
        placeholder="搜尋字型…"
        class="w-56 rounded border border-border bg-background px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
      />
      <label class="flex items-center gap-2">
        <span class="shrink-0">顯示大小</span>
        <input v-model.number="boxPx" type="range" :min="MIN_BOX_PX" :max="MAX_BOX_PX" step="1" class="w-40 accent-[var(--primary)]" />
      </label>
      <FontSampleOptions />
      <span class="ml-auto tabular-nums">{{ shown.length }} 套</span>
    </div>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="error" class="p-4 text-destructive">字體枚舉失敗：{{ error }}</p>
      <p v-else-if="!shown.length" class="p-4 text-muted-foreground">{{ emptyMessage }}</p>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="shown[vrow.index]!.family"
          class="font-row"
          :style="{
            transform: `translateY(${vrow.start}px)`,
            height: `${rowHeight}px`,
            gap: `${ROW_GAP_PX}px`,
            padding: `0 ${ROW_SIDE_PX}px`,
          }"
        >
          <div class="flex shrink-0 flex-col gap-1.5" :style="{ width: `${NAME_COLUMN_PX}px` }">
            <span class="truncate" :title="shown[vrow.index]!.family">{{ shown[vrow.index]!.face.displayName }}</span>
            <span class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span v-if="shown[vrow.index]!.faces.length > 1">{{ shown[vrow.index]!.faces.length }} 個字重</span>
              <span v-if="usedCounts.has(shown[vrow.index]!.family)">本話 {{ usedCounts.get(shown[vrow.index]!.family) }} 句</span>
              <span v-for="g in groupsOf(shown[vrow.index]!.family)" :key="g.id" class="rounded-sm bg-accent px-1 text-accent-foreground">{{ g.name }}</span>
            </span>
            <div class="flex items-center gap-1.5">
              <FontGroupPicker :family="shown[vrow.index]!.family" />
            </div>
          </div>
          <div
            class="sample-cell"
            :style="{ height: `${boxPx}px` }"
            title="直接在樣本上打字。所有字型共用同一段文字"
            @mousedown="aimCell(shown[vrow.index]!.family, $event)"
          >
            <FontSampleCanvas
              :entry="shown[vrow.index]!.face"
              :text="sampleText"
              :size-px="fit.sizePx"
              :fit-width="sampleWidth"
              :fit-height="boxPx"
              :overflows="fit.floored"
              :offset="sampleOffset"
              @scroll="sampleOffset = $event"
              :fill-color="isDark ? DARK_INK : LIGHT_INK"
              :mark="markMissing"
              :editing="aimedAt === shown[vrow.index]!.family"
              :selection="aimedAt === shown[vrow.index]!.family ? sampleRange : null"
              :caret-key="aimedAt === shown[vrow.index]!.family ? sampleCaretKey : 0"
              @select-text="(a, b) => onCellSelect(shown[vrow.index]!.family, a, b)"
              @select-word="onCellWord(shown[vrow.index]!.family, $event)"
              @caret-at="showCaretAt($event)"
            />
          </div>
        </div>
      </div>
    </div>

    <textarea
      ref="sampleEl"
      class="sample-input"
      tabindex="-1"
      spellcheck="false"
      autocorrect="off"
      autocapitalize="off"
      :style="sampleStyle"
      :value="sampleText"
      @input="onSampleInput"
      @blur="onSampleBlur"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { refDebounced, useDark, useElementSize } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { FontEntry } from '@shared/fonts/types'
import FontSampleCanvas from '@/components/FontSampleCanvas.vue'
import FontSampleOptions from '@/components/FontSampleOptions.vue'
import FontGroupPicker from '@/components/fontLibrary/FontGroupPicker.vue'
import { useChapterFontCounts } from '@/composables/useChapterFontCounts'
import { useFontLibrary } from '@/composables/useFontLibrary'
import { DEFAULT_SAMPLE_TEXT, useSampleTyping } from '@/composables/useSampleTyping'
import { catalog, loadFontCatalog, representativeOf } from '@/lib/fontCatalog'
import { coverageFor } from '@/lib/fontSampleCache'
import { sampleFit } from '@/lib/sampleFit'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()
const { section } = useFontLibrary()
const usedCounts = useChapterFontCounts()

// Hex mirrors of --foreground in index.css: the engine paints the sample and
// cannot read CSS variables.
const LIGHT_INK = '#2d2d2b'
const DARK_INK = '#e8e6df'
const isDark = useDark({ initialValue: 'light' })

const MIN_BOX_PX = 32
const MAX_BOX_PX = 240
/** How tall each row's sample box is; the size is whatever fills it. */
const boxPx = ref(64)

const sampleText = computed({
  get: () => preferences.prefs.fontSampleText || DEFAULT_SAMPLE_TEXT,
  set: (text) => preferences.setFontSampleText(text),
})

const sampleEl = useTemplateRef<HTMLTextAreaElement>('sampleEl')
const {
  aimedAt,
  sampleRange,
  sampleCaretKey,
  sampleStyle,
  aimCell,
  onCellSelect,
  onCellWord,
  onSampleInput,
  onSampleBlur,
  showCaretAt,
} = useSampleTyping(sampleText, sampleEl)

const search = ref('')
const appliedSearch = refDebounced(search, 200)
const hidingUndrawable = computed(() => preferences.prefs.missingGlyphMode === 'hide')
const markMissing = computed(() => preferences.prefs.markMissingGlyphs && !hidingUndrawable.value)

function drawsSample(entry: FontEntry): boolean {
  try {
    return coverageFor(entry, sampleText.value).length === 0
  } catch {
    return true
  }
}

/** Filters run on faces, as the picker's do: a family keeps its row while any face can draw the sample. */
const shown = computed(() => {
  const at = section.value
  const group = at.kind === 'group' ? preferences.prefs.fontGroups.find((g) => g.id === at.id) : null
  if (at.kind === 'group' && !group) return []
  const inGroup = group ? new Set(group.families) : null
  let list = catalog.value
  if (at.kind === 'fav') list = list.filter((e) => preferences.favorites.has(e.family))
  if (at.kind === 'used') list = list.filter((e) => usedCounts.value.has(e.family))
  if (inGroup) list = list.filter((e) => inGroup.has(e.family))
  if (hidingUndrawable.value) list = list.filter(drawsSample)
  const q = appliedSearch.value.trim().toLowerCase()
  if (q) list = list.filter((e) => e.displayName.toLowerCase().includes(q) || e.family.toLowerCase().includes(q))

  const families: FontEntry[][] = []
  for (const entry of list) {
    const held = families.at(-1)
    if (held && held[0]!.family === entry.family) held.push(entry)
    else families.push([entry])
  }
  const rows = families.map((faces) => ({ family: faces[0]!.family, faces, face: representativeOf(faces) ?? faces[0]! }))
  // A group lists its families in the order they were put in, the way a playlist does.
  if (group) {
    const order = new Map(group.families.map((f, i) => [f, i]))
    rows.sort((a, b) => order.get(a.family)! - order.get(b.family)!)
  }
  if (at.kind === 'used') {
    rows.sort((a, b) => (usedCounts.value.get(b.family) ?? 0) - (usedCounts.value.get(a.family) ?? 0))
  }
  return rows
})

const groupsOf = (family: string) => preferences.prefs.fontGroups.filter((g) => g.families.includes(family))

const enumerating = ref(false)
const error = ref<string | null>(null)
const emptyMessage = computed(() => {
  if (enumerating.value) return '載入中…'
  if (appliedSearch.value.trim()) return `沒有符合「${appliedSearch.value.trim()}」的字型。`
  const at = section.value
  if (at.kind === 'fav') return '尚無最愛。'
  if (at.kind === 'used') return '這一話還沒有用到這台機器上有的字型。'
  if (at.kind === 'group') return '這個群組還沒有字型。從「全部」裡每套字型的「設置群組」放進來。'
  return '沒有找到任何字型。'
})

onMounted(async () => {
  enumerating.value = true
  try {
    await loadFontCatalog(preferences.prefs.fontFolders)
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    enumerating.value = false
  }
})

const NAME_COLUMN_PX = 256
const ROW_GAP_PX = 24
const ROW_SIDE_PX = 16
const ROW_PADDING_PX = 20
const MIN_ROW_PX = 84

const scrollEl = ref<HTMLElement | null>(null)
const { width: listWidth } = useElementSize(scrollEl)
const sampleWidth = computed(() => Math.max(120, listWidth.value - NAME_COLUMN_PX - ROW_GAP_PX - 2 * ROW_SIDE_PX))
/** How far every clipped row is scrolled; one value, so all rows move together. */
const sampleOffset = ref({ x: 0, y: 0 })
watch([boxPx, sampleWidth], () => (sampleOffset.value = { x: 0, y: 0 }))
const fit = computed(() => sampleFit(sampleText.value, { w: sampleWidth.value, h: boxPx.value }, false))
const rowHeight = computed(() => Math.max(MIN_ROW_PX, boxPx.value + ROW_PADDING_PX))

const virtualizer = useVirtualizer(
  computed(() => ({
    count: shown.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => rowHeight.value,
    overscan: 4,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
watch([rowHeight, shown], () => virtualizer.value.measure())
watch(section, () => scrollEl.value?.scrollTo({ top: 0 }))
</script>

<style scoped>
.font-row {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  width: 100%;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.font-row:hover {
  background: var(--card);
}
.sample-cell {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
/* The same invisible-but-focusable control the picker types its sample into. */
.sample-input {
  z-index: 50;
  padding: 0;
  border: 0;
  resize: none;
  overflow: hidden;
  white-space: pre;
  opacity: 0.01;
  pointer-events: none;
  outline: none;
}
</style>
