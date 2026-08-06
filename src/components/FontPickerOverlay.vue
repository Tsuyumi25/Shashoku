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
      <ToggleGroupRoot
        type="single"
        class="seg shrink-0"
        :model-value="vertical ? 'vertical' : 'horizontal'"
        @update:model-value="onDirection"
      >
        <ToggleGroupItem value="horizontal" class="seg-item">橫排</ToggleGroupItem>
        <ToggleGroupItem value="vertical" class="seg-item">直排</ToggleGroupItem>
      </ToggleGroupRoot>

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

      <span class="shrink-0">字粗</span>
      <input
        type="range"
        :min="WEIGHT_MIN"
        :max="WEIGHT_MAX"
        step="0.25"
        :value="weightPx"
        class="w-24 shrink-0 accent-[var(--primary)]"
        @input="onWeight($event)"
        @dblclick="weightPx = 0"
      />
      <span class="w-8 shrink-0 text-right tabular-nums">{{ weightLabel }}</span>
      <button
        type="button"
        class="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
        :class="showFolders ? 'border-primary text-primary' : ''"
        @click="showFolders = !showFolders"
      >
        字體資料夾{{ preferences.prefs.fontFolders.length ? `(${preferences.prefs.fontFolders.length})` : '' }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-secondary"
        title="Esc"
        @click="picker.cancel()"
      >
        取消
      </button>

      <label
        class="flex shrink-0 items-center gap-1.5"
        title="畫不出當前樣本文字的字體，不列在清單裡"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="hidingUndrawable"
          @change="onHideUndrawable($event)"
        />
        隱藏缺字的字體
      </label>

      <label
        class="flex shrink-0 items-center gap-1.5"
        :class="hidingUndrawable ? 'cursor-not-allowed opacity-40' : ''"
        :title="
          hidingUndrawable
            ? '清單裡沒有缺字的字體了，沒有東西可以標記'
            : '把畫不出來的那幾個字框起來'
        "
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="preferences.prefs.markMissingGlyphs"
          :disabled="hidingUndrawable"
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

    <div
      v-if="showFolders"
      class="flex shrink-0 gap-4 border-b border-border bg-card px-3 py-2 text-xs"
    >
      <div class="min-w-0 flex-1">
        <ul v-if="preferences.prefs.fontFolders.length" class="mb-1.5 flex flex-col gap-1">
          <li
            v-for="folder in preferences.prefs.fontFolders"
            :key="folder"
            class="flex items-center gap-2"
          >
            <span class="min-w-0 flex-1 truncate font-mono" :title="folder">{{ folder }}</span>
            <button
              type="button"
              class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="從清單移除，不會刪除任何檔案"
              @click="removeFolder(folder)"
            >
              <X :size="12" />
            </button>
          </li>
        </ul>
        <p v-else class="mb-1.5 text-muted-foreground">尚未加入資料夾。</p>
        <button
          type="button"
          class="rounded border border-border bg-background px-2 py-0.5 hover:bg-secondary"
          @click="addFolder()"
        >
          新增資料夾…
        </button>
      </div>
      <p class="max-w-80 shrink-0 leading-relaxed text-muted-foreground">
        這些資料夾裡的字體檔會留在原處，Shashoku 直接讀取，不會複製一份。放在機械硬碟上，樣張會慢一些；放在外接裝置上，裝置沒接上時這些字體不會出現在清單裡。內接
        SSD 不會有這兩種情況。
      </p>
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
          <div
            v-for="faces in rows[vrow.index]"
            :key="faces[0]!.family"
            class="font-cell group/cell"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[11px] text-muted-foreground">{{
                  faces[0]!.displayName
                }}</span>
                <span
                  v-if="faces[0]!.family === currentFamily"
                  class="shrink-0 rounded-sm bg-primary/20 px-1 text-[10px] text-primary"
                >
                  目前
                </span>
              </span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 hover:bg-secondary"
                :title="preferences.isFavorite(faces[0]!.family) ? '取消最愛' : '加入最愛'"
                @click="preferences.toggleFavorite(faces[0]!.family)"
              >
                <Star
                  :size="12"
                  :class="
                    preferences.isFavorite(faces[0]!.family)
                      ? 'fill-primary text-primary'
                      : 'text-muted-foreground/50'
                  "
                />
              </button>
            </span>

            <div
              class="cell-sample"
              :class="[canEditInCell ? 'cursor-text' : '', vertical ? 'vertical' : '']"
              :title="
                canEditInCell
                  ? '點一下可以直接改樣本文字'
                  : '這個環境不支援在格子裡編輯，請用上方的樣本文字欄'
              "
              @mousedown="startEditing(shownFace(faces), $event)"
            >
              <FontSampleCanvas
                :entry="shownFace(faces)"
                :text="sample"
                :size-px="appliedSize"
                :fill-color="fillColor"
                :stroke="stroke"
                :vertical="vertical"
                :weight-px="weightPx"
                :mark="markMissing"
                :editing="editingFamily === faces[0]!.family"
                :start-at="editingFamily === faces[0]!.family ? editingAt : undefined"
                @update:text="onEditorText"
                @close="stopEditing(faces[0]!.family)"
              />
            </div>

            <div class="cell-actions">
              <div v-if="faces.length > 1" class="weight-row">
                <button
                  type="button"
                  class="weight-step"
                  title="上一個字重"
                  @click="cycleFace(faces, -1)"
                >
                  &lt;
                </button>
                <span class="weight-name" :title="styleLabel(shownFace(faces))">
                  {{ styleLabel(shownFace(faces)) }} ·
                  {{ faces.indexOf(shownFace(faces)) + 1 }}/{{ faces.length }}
                </span>
                <button
                  type="button"
                  class="weight-step"
                  title="下一個字重"
                  @click="cycleFace(faces, 1)"
                >
                  &gt;
                </button>
              </div>
              <button
                type="button"
                class="cell-action"
                title="按住不放：畫布上選取的文字暫時套這個字款預覽"
                @mouseenter="picker.startPreview(shownFace(faces))"
                @mouseleave="picker.endPreview()"
              >
                預覽
              </button>
              <button
                type="button"
                class="cell-action primary"
                @click="picker.select(shownFace(faces), weightPx)"
              >
                選擇
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { refDebounced, useElementSize, useEventListener } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Star, X } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { MAX_FONT_SAMPLE_PX, MIN_FONT_SAMPLE_PX } from '@shared/preferences/types'
import type { FontEntry } from '@shared/fonts/types'
import FontSampleCanvas from '@/components/FontSampleCanvas.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { canEditInCell } from '@/lib/editContext'
import { catalog, loadFontCatalog, representativeOf } from '@/lib/fontCatalog'
import { coverageFor, samplePadding } from '@/lib/fontSampleCache'
import { usePreferencesStore } from '@/stores/preferencesStore'

const picker = useFontPicker()
const preferences = usePreferencesStore()

type Group = 'all' | 'fav'
const group = ref<Group>('all')

const showFolders = ref(false)

// Presets and the input share one escaped form: a single-line field silently
// drops real newlines, so line breaks are spelled \n and decoded before the
// text reaches the engine.
const SAMPLE_PRESETS = [
  { label: '對白', text: '等一下……你是說真的嗎！？\\n等一下……你是说真的吗！？' },
  { label: '喊叫', text: '哇啊啊啊——不要過來啊！！' },
  { label: '日文', text: 'わかっているのか？ 撃っていいのは、撃たれる覚悟のある奴だけだ！' },
  { label: '檢字', text: '永字八法 體鬱龍書\\n哎呀啊喔 体郁龙书\\nあアぐグ Ag123 0O1Il' },
] as const

const sampleDraft = ref(preferences.prefs.fontSampleText || SAMPLE_PRESETS[0].text)
const sample = computed(() => sampleDraft.value.replaceAll('\\n', '\n'))

watch(sampleDraft, (text) => preferences.setFontSampleText(text))

/**
 * One editor for the whole grid. HTMLElement.editContext binds one to one, and
 * spreadsheets settle the same way — Handsontable keeps a single editor per
 * table, AG Grid a single editable cell.
 */
const editingFamily = ref<string | null>(null)
/** Where the click that opened the editor landed, so the caret starts there. */
const editingAt = ref<{ clientX: number; clientY: number } | null>(null)

function startEditing(entry: FontEntry, e: MouseEvent) {
  if (!canEditInCell || editingFamily.value === entry.family) return
  // A cell is not focusable, so letting the press run its course would clear
  // focus the moment the editor took it — the editor opened and shut again
  // within the same click.
  e.preventDefault()
  editingAt.value = { clientX: e.clientX, clientY: e.clientY }
  editingScrollTop = scrollEl.value?.scrollTop ?? 0
  editingFamily.value = entry.family
}

/**
 * Named rather than unconditional: pressing on another cell moves the caret
 * there before the old editor is told it lost focus, and an anonymous close
 * would then shut the one that just opened.
 */
function stopEditing(family: string) {
  if (editingFamily.value === family) editingFamily.value = null
}

// The editor is a view of the shared sample string, not its owner, so what it
// types goes back through the same field the input above the grid writes to.
function onEditorText(next: string) {
  sampleDraft.value = next.replaceAll('\n', '\\n')
}

const appliedSize = computed(() => preferences.prefs.fontSamplePx)

/**
 * Direction is a property of the style being previewed, so it is re-read every
 * time the picker opens; toggling it here only lasts as long as this opening.
 * With no style behind the request, the last choice is remembered instead.
 */
const vertical = ref(preferences.prefs.fontSampleVertical)

function onDirection(v: unknown) {
  if (v !== 'horizontal' && v !== 'vertical') return
  vertical.value = v === 'vertical'
  if (picker.request.value.vertical === undefined) {
    preferences.setFontSampleVertical(vertical.value)
  }
}

const sampleLines = computed(() => sample.value.split('\n'))
const longestLine = computed(() =>
  sampleLines.value.reduce((most, line) => Math.max(most, line.length), 1),
)

/** Matches the column advance the engine uses for vertical runs. */
const VERTICAL_COLUMN_EM = 1.2
/**
 * Widest a character that is not full-width comes out across this font library.
 * Only horizontal needs guessing: a vertical column advances by a constant the
 * engine sets, the same for every face.
 */
const NARROW_ADVANCE_EM = 0.62
/** Left and right padding of a cell. */
const CELL_SIDE_PADDING_PX = 24

function advanceEm(line: string): number {
  let em = 0
  for (const ch of line) {
    // Everything from Hangul Jamo upward is either full-width or ambiguous
    // punctuation that a CJK face draws full-width; guessing wide only costs
    // space, guessing narrow costs the end of the line.
    em += (ch.codePointAt(0) ?? 0) >= 0x1100 ? 1 : NARROW_ADVANCE_EM
  }
  return em
}

/**
 * Wide enough to hold the sample, because the cell clips what does not fit and
 * a vertical run starts at its right edge — a cell one column short hides the
 * first column, not the last.
 */
const minCellWidth = computed(() => {
  const size = appliedSize.value
  // Ceiling because the engine rounds its bitmap up to whole pixels, and a cell
  // short by that one pixel clips a whole column's worth of edge.
  const body = vertical.value
    ? Math.ceil(size * VERTICAL_COLUMN_EM * sampleLines.value.length)
    : size * sampleLines.value.reduce((most, line) => Math.max(most, advanceEm(line)), 1)
  return Math.ceil(body + samplePadding(stroke.value, weightPx.value) * 2 + CELL_SIDE_PADDING_PX)
})

/**
 * Label, padding, gap and the three action rows around the sample. Only an
 * estimate is needed: every row is measured for real once it exists, and the
 * closer this starts the less the list has to correct afterwards.
 */
const CELL_CHROME_PX = 130
/** A line box runs a little taller than the em; measured across this library. */
const LINE_HEIGHT_RATIO = 1.35

const estimatedRowHeight = computed(() => {
  const size = appliedSize.value
  const body = vertical.value
    ? size * longestLine.value * 1.05
    : size * LINE_HEIGHT_RATIO * sampleLines.value.length
  return Math.round(body + CELL_CHROME_PX)
})

function onSampleSize(e: Event) {
  preferences.setFontSamplePx((e.target as HTMLInputElement).valueAsNumber)
}

const hidingUndrawable = computed(() => preferences.prefs.missingGlyphMode === 'hide')

function onHideUndrawable(e: Event) {
  preferences.setMissingGlyphMode((e.target as HTMLInputElement).checked ? 'hide' : 'tofu')
}

function onMarkMissing(e: Event) {
  preferences.setMarkMissingGlyphs((e.target as HTMLInputElement).checked)
}

// The preference keeps its value while the control is disabled, so unhiding puts
// the marks back the way they were rather than at a default.
const markMissing = computed(
  () => preferences.prefs.markMissingGlyphs && !hidingUndrawable.value,
)

/**
 * Asymmetric for the same reason the style panel's is: thinning holds its shape
 * all the way down, thickening welds neighbouring strokes together early on CJK.
 */
const WEIGHT_MIN = -6
const WEIGHT_MAX = 3

/**
 * Local to this opening, seeded from the style that asked. Held here rather
 * than written straight back so that closing without choosing leaves the object
 * alone — the grid is a place to try weights, and trying is not deciding.
 */
const weightPx = ref(0)
watch(picker.request, (req) => (weightPx.value = req.weightPx ?? 0), { immediate: true })

const weightLabel = computed(() =>
  weightPx.value === 0 ? '0' : `${weightPx.value > 0 ? '+' : ''}${weightPx.value}`,
)

function onWeight(e: Event) {
  const raw = (e.target as HTMLInputElement).valueAsNumber
  if (Number.isFinite(raw)) weightPx.value = raw
}

const currentFamily = computed(() => picker.request.value.current)
const fillColor = computed(() => picker.request.value.fillColor)
const stroke = computed(() => picker.request.value.stroke)

const enumerating = ref(false)
const error = ref<string | null>(null)

const search = ref('')
const appliedSearch = refDebounced(search, 200)

/**
 * One cell per family, every face still reachable: the cell shows one face at
 * a time and its weight row walks the rest. Filters run on faces — a family
 * whose Light lacks the sample glyphs but whose Regular has them keeps the
 * cell and loses the weight.
 */
const displayed = computed(() => {
  let list = catalog.value
  if (group.value === 'fav') list = list.filter((e) => preferences.favorites.has(e.family))
  if (hidingUndrawable.value) {
    // Checking the whole catalogue costs a few milliseconds now that coverage
    // is a cmap read on a mapped file, so there is nothing to schedule.
    list = list.filter((e) => coverageOf(e).length === 0)
  }
  const q = appliedSearch.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (e) => e.displayName.toLowerCase().includes(q) || e.family.toLowerCase().includes(q),
    )
  }
  // The catalogue keeps a family's faces contiguous, so grouping is a fold.
  const families: FontEntry[][] = []
  for (const entry of list) {
    const held = families.at(-1)
    if (held && held[0]!.family === entry.family) held.push(entry)
    else families.push([entry])
  }
  return families
})

/**
 * Which of its faces each family's cell is showing, per opening. Unset means
 * the face the object being styled names, or failing that the family's
 * representative — so a cell starts where the user already is.
 */
const shownIndex = ref(new Map<string, number>())

function shownFace(faces: FontEntry[]): FontEntry {
  const held = shownIndex.value.get(faces[0]!.family)
  if (held !== undefined && held < faces.length) return faces[held]!
  const wanted = picker.request.value.currentFace
  const current = wanted ? faces.findIndex((f) => f.postscriptName === wanted) : -1
  if (current >= 0) return faces[current]!
  const representative = representativeOf(faces)
  return representative ?? faces[0]!
}

function cycleFace(faces: FontEntry[], step: number) {
  const family = faces[0]!.family
  const at = faces.indexOf(shownFace(faces))
  const next = (at + step + faces.length) % faces.length
  shownIndex.value.set(family, next)
  // A Map mutation is invisible to a shallow structure; replacing it is what
  // repaints the cell.
  shownIndex.value = new Map(shownIndex.value)
}

/** What the weight row calls a face that names no style. */
function styleLabel(face: FontEntry): string {
  return face.style || face.postscriptName || '—'
}

function coverageOf(entry: FontEntry): number[] {
  try {
    return coverageFor(entry, sample.value)
  } catch {
    // An unreadable face keeps its place in the list rather than vanishing for
    // a reason the user cannot see.
    return []
  }
}

const familyCount = computed(() => new Set(catalog.value.map((e) => e.family)).size)

const groupTabs = computed(() => [
  { id: 'all' as Group, label: 'All', count: familyCount.value },
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
  const out: FontEntry[][][] = []
  for (let i = 0; i < displayed.value.length; i += perRow) {
    out.push(displayed.value.slice(i, i + perRow))
  }
  return out
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => estimatedRowHeight.value,
    overscan: 6,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

function measureRow(el: unknown) {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}
watch([appliedSize, columns, displayed, vertical], () => virtualizer.value.measure())

/** Where the list stood when editing began, to tell a real scroll from a nudge. */
let editingScrollTop = 0
const SCROLL_SLACK_PX = 2

useEventListener(
  scrollEl,
  'scroll',
  () => {
    // Virtual rows recycle and shift under a scroll, so an editor riding along
    // would have to stay in step with the list. Spreadsheets commit on scroll
    // for the same reason. Measured against where editing started rather than
    // fired on any scroll event, because focusing a partly visible cell scrolls
    // it into view and would otherwise close the editor that just opened.
    const top = scrollEl.value?.scrollTop ?? 0
    if (editingFamily.value && Math.abs(top - editingScrollTop) > SCROLL_SLACK_PX) {
      editingFamily.value = null
    }
  },
  { passive: true },
)

// Enumerating on open rather than at startup. The platform's own list does not
// change while the app runs, so this only repeats when a folder is added.
let enumerated = false

async function refreshCatalog() {
  enumerating.value = true
  try {
    await loadFontCatalog(preferences.prefs.fontFolders)
    enumerated = true
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    console.error('font enumeration failed', err)
    enumerated = false
  } finally {
    enumerating.value = false
  }
}

async function addFolder() {
  const chosen = await window.api.pickFontFolder()
  if (chosen === null) return
  if (preferences.addFontFolder(chosen)) await refreshCatalog()
}

async function removeFolder(path: string) {
  preferences.removeFontFolder(path)
  await refreshCatalog()
}

watch(
  () => picker.isOpen.value,
  async (open) => {
    if (!open) return
    if (!enumerated) await refreshCatalog()
    // Scroll the current family into view instead of typing it into the search
    // box: filtering down to the one font already in use hides exactly what the
    // picker was opened to compare it against.
    search.value = ''
    editingFamily.value = null
    // Fresh per opening, so every cell starts from the face the object names.
    shownIndex.value = new Map()
    vertical.value = picker.request.value.vertical ?? preferences.prefs.fontSampleVertical
    await nextTick()
    requestAnimationFrame(revealCurrentFamily)
  },
)

function revealCurrentFamily() {
  const at = displayed.value.findIndex((faces) => faces[0]!.family === currentFamily.value)
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
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

/* The three rows sit at the bottom whatever the sample above them measured,
 * so a row of cells keeps its controls on one line. */
.cell-actions {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding-top: 0.375rem;
}
.weight-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.weight-step {
  flex-shrink: 0;
  width: 1.75rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  background: var(--background);
  padding: 0.125rem 0;
  font-size: 11px;
  color: var(--foreground);
}
.weight-step:hover {
  background: var(--secondary);
}
.weight-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 11px;
  color: var(--muted-foreground);
}
.cell-action {
  width: 100%;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  background: var(--background);
  padding: 0.125rem 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--foreground);
}
.cell-action:hover {
  background: var(--secondary);
}
.cell-action.primary {
  border-color: transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}
.cell-action.primary:hover {
  background: color-mix(in srgb, var(--primary) 90%, transparent);
}
/*
 * A vertical run reads right to left, so its first column sits against the
 * right edge. Anchoring there means a sample too wide for its cell loses its
 * tail rather than its opening, which is where a horizontal run already loses.
 */
.cell-sample.vertical {
  justify-content: flex-end;
}
</style>
