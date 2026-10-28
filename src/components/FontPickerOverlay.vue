<template>
  <div class="flex h-full w-full flex-col bg-background text-sm">
    <!--
      Two rows, so the row of groups is a row of its own: what is looked at
      leads, what changes how it is drawn sits behind one button, and the one
      control that writes to the selection stays out where it can be seen.
    -->
    <div
      class="flex shrink-0 flex-col gap-1.5 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
    >
      <div class="flex items-center gap-2">
        <input
          v-model="search"
          type="search"
          spellcheck="false"
          placeholder="搜尋字型…"
          class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
        />
        <ToggleGroupRoot
          type="single"
          class="seg shrink-0"
          :model-value="vertical ? 'vertical' : 'horizontal'"
          @update:model-value="onDirection"
        >
          <ToggleGroupItem value="horizontal" class="seg-item">橫排</ToggleGroupItem>
          <ToggleGroupItem value="vertical" class="seg-item">直排</ToggleGroupItem>
        </ToggleGroupRoot>
        <PopoverRoot>
          <PopoverTrigger
            class="shrink-0 rounded p-1 hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
            title="顯示選項"
          >
            <SlidersHorizontal :size="14" />
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent class="picker-options" side="bottom" align="end" :side-offset="6">
              <label class="flex items-center gap-1.5" title="畫不出當前樣本文字的字體，不列在清單裡">
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-primary"
                  :checked="hidingUndrawable"
                  @change="onHideUndrawable($event)"
                />
                隱藏缺字的字體
              </label>
              <label
                class="flex items-center gap-1.5"
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
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>

      <div class="flex items-center gap-1">
        <button
          v-for="g in groupTabs"
          :key="g.id"
          type="button"
          class="shrink-0 rounded px-2 py-0.5 text-xs"
          :class="
            group === g.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground hover:bg-secondary'
          "
          @click="group = g.id"
        >
          {{ g.label }}<span class="ml-1 tabular-nums opacity-60">{{ g.count }}</span>
        </button>
        <span class="ml-auto shrink-0 pl-2" title="每按一下就寫進選取的物件">字粗</span>
        <NumberStepper
          class="shrink-0"
          :model-value="weightPx"
          label="字粗"
          :min="WEIGHT_MIN"
          :max="WEIGHT_MAX"
          :step="0.25"
          @update:model-value="setWeight"
        />
      </div>

      <label class="flex items-center gap-2">
        <span class="shrink-0">顯示大小</span>
        <input
          type="range"
          :min="MIN_FONT_PICKER_BOX_PX"
          :max="MAX_FONT_PICKER_BOX_PX"
          step="1"
          :value="preferences.prefs.fontPickerBoxPx"
          class="min-w-0 flex-1 accent-[var(--primary)]"
          @input="onBoxSize($event)"
        />
      </label>
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
            :style="{ height: `${rowHeight}px` }"
            @mouseenter="hovered = faces"
            @mouseleave="hovered = null"
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
                <span
                  v-if="usedCounts.has(faces[0]!.family)"
                  class="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                  :title="`這一話有 ${usedCounts.get(faces[0]!.family)} 句用這個字型`"
                >
                  {{ usedCounts.get(faces[0]!.family) }}
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
              :class="vertical ? 'vertical' : ''"
              title="直接在樣本上打字。所有格子共用同一段文字"
              @mousedown="aimCell(faces[0]!.family, $event)"
            >
              <FontSampleCanvas
                :entry="shownFace(faces)"
                :text="sampleText"
                :size-px="samplePx"
                :fit-width="box.w"
                :fit-height="box.h"
                :fill-color="fillColor"
                :stroke="sampleStroke"
                :vertical="vertical"
                :weight-px="sampleWeight"
                :mark="markMissing"
                :editing="aimedAt === faces[0]!.family"
                :selection="aimedAt === faces[0]!.family ? sampleRange : null"
                :caret-key="aimedAt === faces[0]!.family ? sampleCaretKey : 0"
                @select-text="(a, b) => onCellSelect(faces[0]!.family, a, b)"
                @select-word="onCellWord(faces[0]!.family, $event)"
                @caret-at="surface.showCaretAt($event)"
              />
            </div>

            <div class="cell-actions">
              <!-- Held when there is nothing to cycle, so every cell is the same height. -->
              <div class="weight-row" :class="faces.length > 1 ? '' : 'invisible'">
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
              <div class="action-row">
                <button
                  type="button"
                  class="cell-action primary"
                  :disabled="targets.length === 0"
                  :title="targets.length === 0 ? '先選一個文字物件' : undefined"
                  @click="choose(shownFace(faces))"
                >
                  選擇
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!--
      Where the sample is actually typed. A real control, holding the real text
      and the real caret, pinned to the insertion point and sized down to a
      sliver — so the IME opens its candidates beside the letters rather than
      beside the panel. Faint rather than hidden: a control that is transparent
      or `display: none` stops being an IME target in some environments, and
      being one is its whole job.
    -->
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { refDebounced, useElementSize } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { SlidersHorizontal, Star } from '@lucide/vue'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  ToggleGroupItem,
  ToggleGroupRoot,
} from 'reka-ui'
import { MAX_FONT_PICKER_BOX_PX, MIN_FONT_PICKER_BOX_PX } from '@shared/preferences/types'
import type { FontEntry } from '@shared/fonts/types'
import type { TextLayerEntry } from '@shared/page/types'
import { blocksOnSide, shownLinesOf } from '@shared/page/units'
import { selectionWords } from '@/lib/selectionWords'
import type { TextStyle } from '@shared/text-style/types'
import { sharedValue } from '@shared/batch/value'
import { engineStrokeFor } from '@shared/effects/stroke'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import FontSampleCanvas from '@/components/FontSampleCanvas.vue'
import NumberStepper from '@/components/NumberStepper.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { createTextEditSurface } from '@/composables/useTextEditSurface'
import { catalog, faceKey, loadFontCatalog, representativeOf } from '@/lib/fontCatalog'
import { coverageFor } from '@/lib/fontSampleCache'
import { usePreferencesStore } from '@/stores/preferencesStore'

const picker = useFontPicker()
const preferences = usePreferencesStore()
const editor = useEditorStore()
const project = useProjectStore()

/** The text objects selected now, which is what the picker reads from and writes to. */
const targets = computed(() =>
  editor
    .selectedNodes()
    .filter((t): t is AppearanceTarget<TextLayerEntry> => t.entry.kind === 'text'),
)
const lead = computed(() => targets.value[0]?.entry)
function agreed<K extends keyof TextStyle>(field: K): boolean {
  return sharedValue(targets.value.map((t) => t.entry.body.style), field).kind !== 'many'
}

/** What the selection says, as one preview text. The sample shows it and never writes it back. */
const objectText = computed(() =>
  selectionWords(
    targets.value.flatMap((t) => {
      const page = project.pageById(t.pageId)?.page
      if (!page) return []
      const place = project.placeOf(t.pageId, t.entry.id)
      return [
        {
          entry: t.entry,
          sentence: place ? `${t.pageId}/${place.unit.id}/${place.side}` : null,
          at: place?.at ?? 0,
          lines: shownLinesOf(page, t.entry),
        },
      ]
    }),
  ),
)

type Group = 'all' | 'fav' | 'used'

/**
 * How many translations in the open chapter each family sets — the faces this
 * work already reaches for, most used first, each drawn with the selection's
 * own words. Only families this machine has can be drawn, so one the chapter
 * names but the catalogue lacks is not in the list.
 */
const usedCounts = computed(() => {
  const out = new Map<string, number>()
  for (const file of project.files) {
    if (file.badge !== 'ok') continue
    for (const block of blocksOnSide(file.page.layers, 'translation')) {
      const family = block.body.style.fontFamily
      if (family) out.set(family, (out.get(family) ?? 0) + 1)
    }
  }
  return out
})
const group = ref<Group>('all')


/** What the cells say before anything is selected or typed. */
const FALLBACK_SAMPLE = '等一下……你是說真的嗎！？\n等一下……你是说真的吗！？'

/**
 * The sample every cell draws. Line breaks are real, because the box holding
 * them is a `textarea` sitting on the sample itself — the `\n` they used to be
 * spelled as was a single-line field's limitation, and it is gone with it.
 */
const savedSample = () => preferences.prefs.fontSampleText || FALLBACK_SAMPLE
const sampleText = ref(objectText.value.trim() ? objectText.value : savedSample())
// An object's own words stand in while it is selected and are not what was saved.
watch(sampleText, (text) => {
  if (text !== objectText.value) preferences.setFontSampleText(text)
})
// The selection's words lead; what was typed into the sample only lasts until it moves.
watch(objectText, (text) => {
  sampleText.value = text.trim() ? text : savedSample()
})

/**
 * The control the sample is typed into. It is never seen: the letters the user
 * is looking at are the engine's, drawn in the cell, and this only holds the
 * keyboard and gives the IME somewhere to open its candidates (ADR 0001,
 * decision 4).
 */
const surface = createTextEditSurface()
const { range: sampleRange, moved: sampleCaretKey } = surface
const sampleEl = ref<HTMLTextAreaElement | null>(null)

watch(sampleEl, (el) => surface.register(el), { immediate: true })

/**
 * Which cell is being typed into, or null.
 *
 * One at a time, because there is one sample string. Held as the family rather
 * than the row, so a scroll that recycles the virtual rows leaves the caret on
 * the cell it belongs to.
 */
const aimedAt = ref<string | null>(null)

function aim(family: string): void {
  if (aimedAt.value !== family) {
    aimedAt.value = family
    surface.pin(true)
  }
  // Guarded, because a drag asks for this on every frame and taking focus that
  // is already held is work for nothing.
  const el = sampleEl.value
  if (el && document.activeElement !== el) el.focus({ preventScroll: true })
}

/** A press on the cell but outside the sample: take the cell, leave the caret. */
function aimCell(family: string, e: MouseEvent) {
  // A cell cannot hold focus itself, so letting the press run its course would
  // clear the focus the control is being given within the same click.
  e.preventDefault()
  aim(family)
}

function onCellSelect(family: string, anchor: number, focus: number) {
  aim(family)
  surface.setRange(anchor, focus)
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' })

function onCellWord(family: string, at: number) {
  aim(family)
  for (const piece of words.segment(sampleText.value)) {
    const end = piece.index + piece.segment.length
    if (at >= piece.index && at < end) {
      surface.setRange(piece.index, end)
      return
    }
  }
}

function onSampleInput(e: Event) {
  sampleText.value = (e.target as HTMLTextAreaElement).value
}

/**
 * A new selection replaces the text under the caret without an `input` event to say
 * so, so the control's own selection is what the projection has to be told
 * about — the browser has already clamped it by the time this runs.
 */
watch(sampleText, () => surface.read(), { flush: 'post' })

function onSampleBlur() {
  aimedAt.value = null
  surface.pin(false)
  surface.showCaretAt(null)
}

/**
 * Parked when no cell is aimed. It is never focused then, so it cannot pull the
 * window's scroll — which is the one thing an off-screen focused element does.
 */
const PARKED = {
  position: 'fixed' as const,
  left: '0px',
  top: '0px',
  width: '1px',
  height: '1px',
}

const sampleStyle = computed(() => {
  const box = surface.pinnedBox.value
  if (box === null) return PARKED
  return {
    position: 'fixed' as const,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    writingMode: box.vertical ? ('vertical-rl' as const) : ('horizontal-tb' as const),
  }
})


/**
 * Direction follows the selected object; toggling it here lasts until the
 * selection moves. With nothing selected, the last choice is remembered instead.
 */
const objectVertical = computed<boolean | undefined>(() =>
  lead.value ? lead.value.body.style.direction === 'vertical' : undefined,
)
const vertical = ref(objectVertical.value ?? preferences.prefs.fontSampleVertical)
watch(objectVertical, (v) => (vertical.value = v ?? preferences.prefs.fontSampleVertical))

function onDirection(v: unknown) {
  if (v !== 'horizontal' && v !== 'vertical') return
  vertical.value = v === 'vertical'
  if (objectVertical.value === undefined) {
    preferences.setFontSampleVertical(vertical.value)
  }
}

const sampleLines = computed(() => sampleText.value.split('\n'))
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
 * The box every sample is shown in, in CSS pixels: wide for rows, tall for
 * columns. Its size is the display size and nothing else, so every cell is the
 * same size whichever face it draws.
 */
const box = computed(() => {
  const d = preferences.prefs.fontPickerBoxPx
  return vertical.value ? { w: d, h: d * 2 } : { w: d * 2, h: d }
})

/** Room a sample keeps from its box's edge, in CSS pixels. */
const BOX_MARGIN_PX = 8
/** Smallest a sample is set at however long the text, in CSS pixels. */
const MIN_SAMPLE_PX = 6

/**
 * The size that fills the box with this sample, worked out from the text alone
 * so it is the same for every face. A long line sets small; a short one large.
 */
const samplePx = computed(() => {
  const { w, h } = box.value
  const lines = sampleLines.value
  const fit = vertical.value
    ? Math.min(
        (w - BOX_MARGIN_PX) / (VERTICAL_COLUMN_EM * lines.length),
        (h - BOX_MARGIN_PX) / (longestLine.value * 1.05),
      )
    : Math.min(
        (w - BOX_MARGIN_PX) / lines.reduce((most, line) => Math.max(most, advanceEm(line)), 1),
        (h - BOX_MARGIN_PX) / (LINE_HEIGHT_RATIO * lines.length),
      )
  return Math.max(MIN_SAMPLE_PX, Math.floor(fit))
})

const minCellWidth = computed(() => box.value.w + CELL_SIDE_PADDING_PX)

/** Label, padding, gaps and the two action rows around the sample. */
const CELL_CHROME_PX = 118
/** A line box runs a little taller than the em; measured across this library. */
const LINE_HEIGHT_RATIO = 1.35

const rowHeight = computed(() => box.value.h + CELL_CHROME_PX)

function onBoxSize(e: Event) {
  preferences.setFontPickerBoxPx((e.target as HTMLInputElement).valueAsNumber)
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

/** Seeded from the selected object, and following it as the selection moves. */
const objectWeight = computed(() => (lead.value && agreed('weightPx') ? lead.value.body.style.weightPx : 0))
const weightPx = ref(objectWeight.value)
watch(objectWeight, (w) => (weightPx.value = w))

/**
 * Each step is one step of history on the selection. With nothing selected it
 * only changes the samples.
 */
function setWeight(px: number) {
  if (px === weightPx.value) return
  weightPx.value = px
  if (targets.value.length > 0) editor.cmdApplyStyle(targets.value, { weightPx: px })
}

const currentFamily = computed(() =>
  lead.value && agreed('fontFamily') ? lead.value.body.style.fontFamily : '',
)
const fillColor = computed(() => lead.value?.body.style.color ?? '#000000')
const stroke = computed(() => (lead.value ? engineStrokeFor(lead.value.effects) : undefined))

/**
 * The object's stroke and weight are pixels at its own size; the sample is set
 * at another, so both are scaled to keep the proportion the object will have.
 */
const sizeRatio = computed(() => {
  const objectPx = lead.value && agreed('fontSizePx') ? lead.value.body.style.fontSizePx : 0
  return objectPx > 0 ? samplePx.value / objectPx : 1
})
const sampleStroke = computed(() =>
  stroke.value ? { ...stroke.value, width: stroke.value.width * sizeRatio.value } : undefined,
)
const sampleWeight = computed(() => weightPx.value * sizeRatio.value)

/**
 * The family under the pointer. Being over a cell is the preview: the canvas
 * draws the selection in that cell's face, and leaving every cell restores it.
 */
const hovered = ref<FontEntry[] | null>(null)
watch(
  () => (hovered.value ? shownFace(hovered.value) : null),
  (face) => (face ? picker.startPreview(face) : picker.endPreview()),
)
onBeforeUnmount(() => picker.endPreview())

/** Writes the face to every selected text object; the weight is already theirs. */
function choose(face: FontEntry) {
  const patch: Partial<TextStyle> = {
    fontFamily: face.family,
    fontFace: face.postscriptName,
    fontStyleName: face.style,
  }
  editor.cmdApplyStyle(targets.value, patch)
}

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
  if (group.value === 'used') list = list.filter((e) => usedCounts.value.has(e.family))
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
  if (group.value === 'used') {
    // Stable, so families used equally often keep the catalogue's order.
    families.sort((a, b) => (usedCounts.value.get(b[0]!.family) ?? 0) - (usedCounts.value.get(a[0]!.family) ?? 0))
  }
  return families
})

/**
 * Which of its faces each family's cell is showing, per opening. Unset means
 * the face the object being styled names, or failing that the family's
 * representative — so a cell starts where the user already is.
 *
 * Held as the face's key rather than its position: the list being walked is
 * the filtered one, and a filter change — new sample text, 隱藏缺字 — would
 * quietly re-aim a stored position at whichever face slid into it.
 */
const shownKey = ref(new Map<string, string>())

function shownFace(faces: FontEntry[]): FontEntry {
  const held = shownKey.value.get(faces[0]!.family)
  if (held !== undefined) {
    const face = faces.find((f) => faceKey(f) === held)
    if (face) return face
  }
  const wanted = lead.value && agreed('fontFace') ? lead.value.body.style.fontFace : undefined
  const current = wanted ? faces.findIndex((f) => f.postscriptName === wanted) : -1
  if (current >= 0) return faces[current]!
  const representative = representativeOf(faces)
  return representative ?? faces[0]!
}

function cycleFace(faces: FontEntry[], step: number) {
  const at = faces.indexOf(shownFace(faces))
  const next = faces[(at + step + faces.length) % faces.length]!
  shownKey.value.set(faces[0]!.family, faceKey(next))
  // A Map mutation is invisible to a shallow structure; replacing it is what
  // repaints the cell.
  shownKey.value = new Map(shownKey.value)
}

/** What the weight row calls a face that names no style. */
function styleLabel(face: FontEntry): string {
  return face.style || face.postscriptName || '—'
}

function coverageOf(entry: FontEntry): number[] {
  try {
    return coverageFor(entry, sampleText.value)
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
  { id: 'used' as Group, label: '本話', count: displayedUsed.value },
])

const displayedUsed = computed(
  () => new Set(catalog.value.filter((e) => usedCounts.value.has(e.family)).map((e) => e.family)).size,
)

const emptyMessage = computed(() => {
  if (enumerating.value) return '載入中…'
  if (appliedSearch.value.trim()) return `沒有符合「${appliedSearch.value.trim()}」的字體。`
  if (group.value === 'fav') return '尚無最愛。'
  if (group.value === 'used') return '這一話還沒有用到這台機器上有的字型。'
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
    estimateSize: () => rowHeight.value,
    overscan: 2,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

watch([rowHeight, columns, displayed], () => virtualizer.value.measure())

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

watch(
  () => picker.isOpen.value,
  async (open) => {
    if (!open) return
    if (!enumerated) await refreshCatalog()
    // Scroll the current family into view instead of typing it into the search
    // box: filtering down to the one font already in use hides exactly what the
    // picker was opened to compare it against.
    search.value = ''
    // No cell is being typed into yet, so the control goes back to its park.
    onSampleBlur()
    // Fresh per opening, so every cell starts from the face the object names.
    shownKey.value = new Map()
    await nextTick()
    requestAnimationFrame(revealCurrentFamily)
  },
)

function revealCurrentFamily() {
  const at = displayed.value.findIndex((faces) => faces[0]!.family === currentFamily.value)
  if (at < 0) return
  virtualizer.value.scrollToIndex(Math.floor(at / columns.value), { align: 'center' })
}

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
.action-row {
  display: flex;
  gap: 0.375rem;
}
.cell-action {
  flex: 1 1 0;
  min-width: 0;
  min-height: 2rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  background: var(--background);
  padding: 0.375rem 0.5rem;
  font-size: 12px;
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
 * One or two pixels of a colour nothing is drawn in, which is invisible in
 * practice without ever claiming to be hidden. `pointer-events: none` because
 * the thing the pointer works on is the sample, not this.
 */
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
/*
 * A vertical run reads right to left, so its first column sits against the
 * right edge. Anchoring there means a sample too wide for its cell loses its
 * tail rather than its opening, which is where a horizontal run already loses.
 */
.cell-sample.vertical {
  justify-content: flex-end;
}
</style>

<style>
/* Portalled out of the component, so the scoped block does not reach it. */
.picker-options {
  z-index: 50;
  display: flex;
  width: 15rem;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 0.75rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
</style>
