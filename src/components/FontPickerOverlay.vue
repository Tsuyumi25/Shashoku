<template>
  <div class="flex h-full w-full flex-col bg-background text-sm">
    <div
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
    >
      <input
        v-model="search"
        type="search"
        spellcheck="false"
        placeholder="搜尋字型…"
        class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
      />
      <div class="flex shrink-0 gap-1">
        <button
          v-for="g in groupTabs"
          :key="g.id"
          type="button"
          class="rounded px-2 py-0.5 text-xs"
          :class="
            group === g.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground hover:bg-secondary'
          "
          @click="group = g.id"
        >
          {{ g.label }}({{ g.count }})
        </button>
      </div>
      <span class="shrink-0">字級</span>
      <input
        type="range"
        :min="MIN_FONT_SAMPLE_PX"
        :max="MAX_FONT_SAMPLE_PX"
        step="1"
        :value="preferences.prefs.fontSamplePx"
        class="w-32 shrink-0 accent-[var(--primary)]"
        @input="onSampleSize($event)"
      />
      <span class="w-10 shrink-0 text-right tabular-nums">
        {{ preferences.prefs.fontSamplePx }}px
      </span>
      <button
        type="button"
        class="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
        title="Esc"
        @click="picker.cancel()"
      >
        取消
      </button>

      <span class="shrink-0">缺字的字體</span>
      <ToggleGroupRoot
        type="single"
        class="seg shrink-0"
        :model-value="preferences.prefs.missingGlyphMode"
        @update:model-value="onMissingGlyphMode"
      >
        <ToggleGroupItem
          value="hide"
          class="seg-item"
          title="畫不出當前樣本文字的字體，不列在清單裡"
        >
          不顯示
        </ToggleGroupItem>
        <ToggleGroupItem
          value="substitute"
          class="seg-item"
          title="畫不出來的字，改用指定的字體畫"
        >
          換字體
        </ToggleGroupItem>
        <ToggleGroupItem
          value="tofu"
          class="seg-item"
          title="畫不出來的字顯示成空方框，不替換"
        >
          顯示方框
        </ToggleGroupItem>
      </ToggleGroupRoot>

      <template v-if="preferences.prefs.missingGlyphMode === 'substitute'">
        <span class="shrink-0">換成</span>
        <select
          class="h-6 max-w-44 min-w-0 shrink rounded border border-input bg-background px-1 text-foreground"
          :value="preferences.prefs.fontFallbackFamily"
          @change="onFallbackFamily($event)"
        >
          <option value="">未指定</option>
          <option v-for="entry in catalog" :key="entry.family" :value="entry.family">
            {{ entry.displayName }}
          </option>
        </select>
      </template>

      <label
        v-if="preferences.prefs.missingGlyphMode !== 'hide'"
        class="flex shrink-0 items-center gap-1.5"
        title="把畫不出來的那幾個字框起來"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="preferences.prefs.markMissingGlyphs"
          @change="onMarkMissing($event)"
        />
        標記缺字
      </label>
    </div>

    <div
      class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-1 text-xs"
    >
      <button
        v-for="p in SAMPLE_PRESETS"
        :key="p.label"
        type="button"
        class="shrink-0 rounded px-2 py-0.5"
        :class="
          sampleDraft === p.text
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-secondary'
        "
        :title="p.text"
        @click="sampleDraft = p.text"
      >
        {{ p.label }}
      </button>
      <input
        v-model="sampleDraft"
        spellcheck="false"
        placeholder="樣本文字"
        title="換行請用 \n"
        class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
      />
    </div>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="error" class="p-4 text-destructive">字體枚舉失敗：{{ error }}</p>
      <p v-else-if="!displayed.length" class="p-4 text-muted-foreground">
        {{ emptyMessage }}
      </p>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="vrow.index"
          :ref="measureRow"
          :data-index="vrow.index"
          class="font-row absolute left-0 top-0 w-full"
          :style="{
            transform: `translateY(${vrow.start}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }"
        >
          <div v-for="entry in rows[vrow.index]" :key="entry.family" class="font-cell group/cell">
            <span class="flex items-center justify-between gap-2">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[11px] text-muted-foreground">{{ entry.displayName }}</span>
                <span
                  v-if="entry.family === currentFamily"
                  class="shrink-0 rounded-sm bg-primary/20 px-1 text-[10px] text-primary"
                >
                  目前
                </span>
              </span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 hover:bg-secondary"
                :title="preferences.isFavorite(entry.family) ? '取消最愛' : '加入最愛'"
                @click="preferences.toggleFavorite(entry.family)"
              >
                <Star
                  :size="12"
                  :class="
                    preferences.isFavorite(entry.family)
                      ? 'fill-primary text-primary'
                      : 'text-muted-foreground/50'
                  "
                />
              </button>
            </span>

            <div class="cell-sample">
              <FontSampleCanvas
                :entry="entry"
                :text="sample"
                :size-px="appliedSize"
                :fill-color="fillColor"
                :stroke="stroke"
                :fallback="fallbackEntry"
                :mark="markMissing"
                :deferred="fastScroll"
              />
            </div>

            <button
              type="button"
              class="absolute bottom-1.5 right-1.5 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground opacity-0 shadow-sm transition-opacity hover:bg-primary/90 group-hover/cell:opacity-100"
              @click="picker.select(entry.family)"
            >
              選擇
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { refDebounced, useElementSize, useEventListener } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Star } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { MAX_FONT_SAMPLE_PX, MIN_FONT_SAMPLE_PX } from '@shared/preferences/types'
import type { FontEntry } from '@shared/fonts/types'
import FontSampleCanvas from '@/components/FontSampleCanvas.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { coverageFor } from '@/lib/fontSampleCache'
import { usePreferencesStore } from '@/stores/preferencesStore'

const picker = useFontPicker()
const preferences = usePreferencesStore()

type Group = 'all' | 'fav'
const group = ref<Group>('all')

// Presets and the input share one escaped form: a single-line field silently
// drops real newlines, so line breaks are spelled \n and decoded before the
// text reaches the engine.
const SAMPLE_PRESETS = [
  { label: '對白', text: '等一下……你是說真的嗎!?\\n等一下……你是说真的吗!?' },
  { label: '喊叫', text: '哇啊啊啊——不要過來啊!!' },
  { label: '日文', text: 'わかっているのか? 撃っていいのは、撃たれる覚悟のある奴だけだ!' },
  { label: '檢字', text: '永字八法 體鬱龍書\\n哎呀啊喔 体郁龙书\\nあアぐグ Ag123 0O1Il' },
] as const

const sampleDraft = ref(preferences.prefs.fontSampleText || SAMPLE_PRESETS[0].text)
const sampleApplied = refDebounced(sampleDraft, 250)
const sample = computed(() => sampleApplied.value.replaceAll('\\n', '\n'))

watch(sampleApplied, (text) => preferences.setFontSampleText(text))

const appliedSize = refDebounced(
  computed(() => preferences.prefs.fontSamplePx),
  150,
)
const minCellWidth = computed(() => Math.round(appliedSize.value * 13))

function onSampleSize(e: Event) {
  preferences.setFontSamplePx((e.target as HTMLInputElement).valueAsNumber)
}

function onMissingGlyphMode(v: unknown) {
  if (v === 'hide' || v === 'substitute' || v === 'tofu') preferences.setMissingGlyphMode(v)
}

function onFallbackFamily(e: Event) {
  preferences.setFontFallbackFamily((e.target as HTMLSelectElement).value)
}

function onMarkMissing(e: Event) {
  preferences.setMarkMissingGlyphs((e.target as HTMLInputElement).checked)
}

const fallbackEntry = computed(() => {
  if (preferences.prefs.missingGlyphMode !== 'substitute') return undefined
  const family = preferences.prefs.fontFallbackFamily
  return family ? catalog.value.find((e) => e.family === family) : undefined
})

const markMissing = computed(
  () => preferences.prefs.markMissingGlyphs && preferences.prefs.missingGlyphMode !== 'hide',
)

const currentFamily = computed(() => picker.request.value.current)
const fillColor = computed(() => picker.request.value.fillColor)
const stroke = computed(() => picker.request.value.stroke)

// Shallow: entries are never mutated, and proxying a thousand of them would
// both cost for nothing and risk handing a Proxy to the engine bridge.
const catalog = shallowRef<FontEntry[]>([])
const enumerating = ref(false)
const error = ref<string | null>(null)

const search = ref('')
const appliedSearch = refDebounced(search, 200)

const displayed = computed(() => {
  let list = catalog.value
  if (group.value === 'fav') list = list.filter((e) => preferences.favorites.has(e.family))
  if (preferences.prefs.missingGlyphMode === 'hide') {
    // Checking the whole catalogue costs a few milliseconds now that coverage
    // is a cmap read on a mapped file, so there is nothing to schedule.
    list = list.filter((e) => coverageOf(e).length === 0)
  }
  const q = appliedSearch.value.trim().toLowerCase()
  return q
    ? list.filter(
        (e) =>
          e.displayName.toLowerCase().includes(q) || e.family.toLowerCase().includes(q),
      )
    : list
})

function coverageOf(entry: FontEntry): number[] {
  try {
    return coverageFor(entry, sample.value)
  } catch {
    // An unreadable face keeps its place in the list rather than vanishing for
    // a reason the user cannot see.
    return []
  }
}

const groupTabs = computed(() => [
  { id: 'all' as Group, label: 'All', count: catalog.value.length },
  { id: 'fav' as Group, label: 'Fav', count: preferences.prefs.fontFavorites.length },
])

const emptyMessage = computed(() => {
  if (enumerating.value) return '載入中…'
  if (appliedSearch.value.trim()) return `沒有符合「${appliedSearch.value.trim()}」的字體。`
  if (group.value === 'fav') return '尚無最愛。'
  return '系統沒有回報任何字體。'
})

const scrollEl = ref<HTMLElement | null>(null)
const { width: gridWidth } = useElementSize(scrollEl)
const columns = computed(() => Math.max(1, Math.floor(gridWidth.value / minCellWidth.value)))
const rows = computed(() => {
  const perRow = columns.value
  const out: FontEntry[][] = []
  for (let i = 0; i < displayed.value.length; i += perRow) {
    out.push(displayed.value.slice(i, i + perRow))
  }
  return out
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => Math.round(appliedSize.value * 1.5 + 40),
    overscan: 6,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

function measureRow(el: unknown) {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}
watch([appliedSize, columns, displayed], () => virtualizer.value.measure())

// Flinging the scrollbar would otherwise queue a rasterize for every row it
// passes, none of which the user is going to look at.
const fastScroll = ref(false)
const FAST_PX_PER_FRAME = 360
const SETTLE_MS = 150
let previousTop = 0
let scrollFrame = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined

useEventListener(
  scrollEl,
  'scroll',
  () => {
    if (scrollFrame) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      const el = scrollEl.value
      if (!el) return
      if (Math.abs(el.scrollTop - previousTop) > FAST_PX_PER_FRAME) fastScroll.value = true
      previousTop = el.scrollTop
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        fastScroll.value = false
      }, SETTLE_MS)
    })
  },
  { passive: true },
)

// Enumerating on open rather than at startup, and only once — the list does
// not change while the app runs.
let enumerated = false

watch(
  () => picker.isOpen.value,
  async (open) => {
    if (!open) return
    if (!enumerated) {
      enumerated = true
      enumerating.value = true
      try {
        catalog.value = await loadFontCatalog()
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
        console.error('font enumeration failed', err)
        enumerated = false
      } finally {
        enumerating.value = false
      }
    }
    // Scroll the current family into view instead of typing it into the search
    // box: filtering down to the one font already in use hides exactly what the
    // picker was opened to compare it against.
    search.value = ''
    previousTop = 0
    await nextTick()
    requestAnimationFrame(revealCurrentFamily)
  },
)

function revealCurrentFamily() {
  const at = displayed.value.findIndex((e) => e.family === currentFamily.value)
  if (at < 0) return
  virtualizer.value.scrollToIndex(Math.floor(at / columns.value), { align: 'center' })
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!picker.isOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    picker.cancel()
  }
})
</script>

<style scoped>
.font-row {
  display: grid;
  animation: row-in 150ms ease-in;
}
@keyframes row-in {
  from {
    opacity: 0;
  }
}
.font-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.625rem 0.75rem;
  background: var(--background);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.font-cell:hover {
  background: var(--card);
}
.cell-sample {
  min-width: 0;
  overflow: hidden;
}
</style>
