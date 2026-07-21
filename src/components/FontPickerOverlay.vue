<template>
  <!-- 字型 picker overlay:視覺覆蓋畫布區域(TranslateMode 內用 absolute
       inset-0 定位)。內容是字體 mode 右半邊的複製 —— 搜索 + 群組切換 +
       字級 slider + 樣本切換 + 虛擬列表 grid,但每個 cell 右下角多一個
       「選擇」按鈕、頂部多一個「取消」按鈕。picker 開啟時才 load 字體
       清單(v-show 常駐、關閉不丟狀態,再次開啟不重掃)。
       目前和 FontMode 兩地維護 —— 兩份邏輯需要同步時再考慮抽 FontListView。 -->
  <div class="flex h-full w-full flex-col bg-background text-sm">
    <div
      class="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
    >
      <input
        v-model="search"
        type="search"
        spellcheck="false"
        placeholder="搜索字型…"
        class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
      />
      <div class="flex shrink-0 gap-1">
        <button
          v-for="g in groupList"
          :key="g.id"
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
        v-model.number="fontSize"
        type="range"
        min="14"
        max="64"
        step="1"
        class="w-32 shrink-0 accent-[var(--primary)]"
      />
      <span class="w-10 shrink-0 text-right tabular-nums">{{ fontSize }}px</span>
      <button
        class="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
        title="Esc"
        @click="picker.cancel()"
      >
        取消
      </button>
    </div>

    <div
      class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-1 text-xs"
    >
      <button
        v-for="p in SAMPLE_PRESETS"
        :key="p.label"
        class="shrink-0 rounded px-2 py-0.5"
        :class="
          sample === p.text
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-secondary'
        "
        :title="p.text"
        @click="sample = p.text"
      >
        {{ p.label }}
      </button>
      <span class="min-w-0 truncate pl-1 text-muted-foreground/60">{{ sample }}</span>
    </div>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="error" class="p-4 text-destructive">字體枚舉失敗:{{ error }}</p>
      <p v-else-if="!displayed.length" class="p-4 text-muted-foreground">
        {{
          appliedSearch.trim()
            ? `沒有符合「${appliedSearch.trim()}」的字體。`
            : group === 'fav'
              ? '尚無最愛。'
              : group === 'imported'
                ? '尚未匯入字體資料夾(去「字體」mode 匯入)。'
                : '載入中…'
        }}
      </p>
      <div
        v-else
        class="relative w-full"
        :style="{ height: `${totalSize}px`, '--preview-size': `${appliedSize}px` }"
      >
        <div
          v-for="vrow in virtualRows"
          :key="vrow.index"
          :ref="measureRow"
          :data-index="vrow.index"
          class="font-row absolute left-0 top-0 w-full"
          :style="{
            transform: `translateY(${vrow.start}px)`,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }"
        >
          <div v-for="f in rows[vrow.index]" :key="f" class="font-cell group/cell">
            <span class="flex items-center justify-between gap-2">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[11px] text-muted-foreground">{{ f }}</span>
                <span
                  v-if="importedSet.has(f)"
                  class="shrink-0 rounded-sm bg-secondary px-1 text-[10px] text-muted-foreground"
                  >匯入</span
                >
                <span
                  v-if="f === currentFont"
                  class="shrink-0 rounded-sm bg-primary/20 px-1 text-[10px] text-primary"
                  >目前</span
                >
              </span>
            </span>
            <span
              v-if="fastScroll && !loadedFamilies.has(f)"
              class="cell-loading text-muted-foreground/40"
              >正在加載……</span
            >
            <span
              v-else
              class="cell-sample"
              :style="{ fontFamily: `'${f.replaceAll(`'`, '')}'` }"
              >{{ sample }}</span
            >
            <button
              type="button"
              class="absolute bottom-1.5 right-1.5 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground opacity-0 shadow-sm transition-opacity hover:bg-primary/90 group-hover/cell:opacity-100"
              @click="picker.select(f)"
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
import { computed, ref, watch } from 'vue'
import { refDebounced, useElementSize, useEventListener, useLocalStorage } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useFontPicker } from '@/composables/useFontPicker'
import { importedFamilies } from '@/lib/importedFonts'

const picker = useFontPicker()

type Group = 'all' | 'fav' | 'imported'
const group = ref<Group>('all')

const SAMPLE_PRESETS = [
  { label: '對白', text: '等一下……你是說真的嗎!?\n等一下……你是说真的吗!?' },
  { label: '喊叫', text: '哇啊啊啊——不要過來啊!!' },
  { label: '日文', text: 'わかっているのか? 撃っていいのは、撃たれる覚悟のある奴だけだ!' },
  { label: '檢字', text: '永字八法 體鬱龍書\n哎呀啊喔 体郁龙书\nあアぐグ Ag123 0O1Il' },
] as const

const sample = ref<string>(SAMPLE_PRESETS[0].text)

const fontSize = ref(40)
const appliedSize = refDebounced(fontSize, 150)
const appliedMinW = computed(() => Math.round(appliedSize.value * 13))

const favs = useLocalStorage<string[]>('shashoku:font-favs', [])
const favSet = computed(() => new Set(favs.value))

const systemFamilies = ref<string[]>([])
const error = ref<string | null>(null)

const importedSet = computed(() => new Set(importedFamilies.value))
const allFamilies = computed(() =>
  [...new Set([...systemFamilies.value, ...importedSet.value])].sort((a, b) =>
    a.localeCompare(b, 'zh-Hant'),
  ),
)
const search = ref('')
const appliedSearch = refDebounced(search, 200)

/** picker 開啟時 initialQuery 預填搜索框(讓用戶看得到當前字型當出發點) */
const currentFont = computed(() => picker.initialQuery.value)
watch(
  () => picker.isOpen.value,
  (open) => {
    if (open) search.value = picker.initialQuery.value
  },
)

const displayed = computed(() => {
  let list = allFamilies.value
  if (group.value === 'fav') list = list.filter((f) => favSet.value.has(f))
  else if (group.value === 'imported') list = list.filter((f) => importedSet.value.has(f))
  const q = appliedSearch.value.trim().toLowerCase()
  return q ? list.filter((f) => f.toLowerCase().includes(q)) : list
})

const scrollEl = ref<HTMLElement | null>(null)
const { width: gridWidth } = useElementSize(scrollEl)
const cols = computed(() => Math.max(1, Math.floor(gridWidth.value / appliedMinW.value)))
const rows = computed(() => {
  const c = cols.value
  const out: string[][] = []
  for (let i = 0; i < displayed.value.length; i += c) out.push(displayed.value.slice(i, i + c))
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
watch([appliedSize, cols, displayed], () => virtualizer.value.measure())

const fastScroll = ref(false)
const FAST_PX_PER_FRAME = 360
let prevTop = 0
let scrollRaf = 0
let settleTimer = 0
useEventListener(
  scrollEl,
  'scroll',
  () => {
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      const el = scrollEl.value
      if (!el) return
      const top = el.scrollTop
      if (Math.abs(top - prevTop) > FAST_PX_PER_FRAME) fastScroll.value = true
      prevTop = top
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        fastScroll.value = false
      }, 150)
    })
  },
  { passive: true },
)

const loadedFamilies = new Set<string>()
watch(
  [virtualRows, fastScroll],
  () => {
    if (fastScroll.value) return
    for (const vrow of virtualRows.value)
      for (const f of rows.value[vrow.index] ?? []) loadedFamilies.add(f)
  },
  { flush: 'post' },
)

const groupList = computed(() => [
  { id: 'all' as Group, label: 'All', count: allFamilies.value.length },
  { id: 'fav' as Group, label: 'Fav', count: favs.value.length },
  { id: 'imported' as Group, label: '匯入', count: importedFamilies.value.length },
])

/** picker 打開時才 load 字體清單(不搶 app 啟動路徑),只 load 一次不重掃 */
let loaded = false
watch(
  () => picker.isOpen.value,
  async (open) => {
    if (!open || loaded) return
    loaded = true
    try {
      const faces = await queryLocalFonts()
      systemFamilies.value = [...new Set(faces.map((f) => f.family))]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      loaded = false
    }
  },
  { immediate: true },
)

/** Esc 取消 picker(overlay 開啟時才攔) */
useEventListener(window, 'keydown', (e) => {
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
.font-cell .cell-sample,
.font-cell .cell-loading {
  line-height: normal;
  font-size: var(--preview-size, 40px);
  white-space: pre-wrap;
}
</style>
