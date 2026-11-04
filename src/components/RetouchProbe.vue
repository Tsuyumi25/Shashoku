<template>
  <!--
    ⚠️ A probe, not a feature. It is here to find out whether a selection made
    by hand can be grown and handed to the model at all, and what the result
    looks like on a real page — the two things no amount of reading the model's
    card answers.
  -->
  <div class="shrink-0 border-b border-border">
    <div class="probe-head">
      <span class="text-xs font-medium">動作</span>
      <span class="ml-auto pr-1 text-[12px] text-muted-foreground">{{ standing }}</span>
    </div>

    <div class="flex flex-wrap items-center gap-1 px-2 pt-2">
      <!--
        ⭐ One button, because every reader is asked every time. Four buttons
        made "how many models agree" depend on which ones somebody happened to
        press, which is the number the page's own decision leans on hardest.
      -->
      <button
        type="button"
        class="route-btn route-btn-go"
        :disabled="reading || !currentFile || ocr.chapter !== null"
        title="兩個偵測器找出哪裡有字，量出每個區域怎麼排，四個辨識器每一個都被問"
        @click="readPage"
      >
        <LoaderCircle v-if="reading" :size="12" class="animate-spin" />
        <ScanText v-else :size="12" />
        <span>辨識本頁</span>
        <span v-if="pool.length" class="route-count">{{ pool.length }}</span>
      </button>

      <button
        v-if="ocr.chapter === null"
        type="button"
        class="route-btn"
        :disabled="ocr.running.size > 0 || project.files.length === 0"
        title="從第一頁讀到最後一頁，一頁讀完才讀下一頁；每一頁做的跟「辨識本頁」一樣"
        @click="ocr.readChapter()"
      >
        <ScanText :size="12" />
        <span>辨識全部頁面</span>
      </button>
      <button
        v-else
        type="button"
        class="route-btn"
        :disabled="ocr.stopping"
        title="讀完手上這一頁就停"
        @click="ocr.stopChapter()"
      >
        <LoaderCircle :size="12" class="animate-spin" />
        <span>{{ ocr.stopping ? '這頁讀完就停' : '停止' }}</span>
        <span class="route-count">{{ ocr.chapter.at }}/{{ ocr.chapter.of }}</span>
      </button>

      <button
        v-if="pageId && pool.length"
        type="button"
        class="route-btn"
        :class="[ocr.showing(pageId) && 'route-btn-boxes']"
        title="把辨識到的區域畫在畫稿上"
        @click="ocr.toggleBoxes(pageId)"
      >
        <SquareDashed :size="11" />
        <span>框</span>
      </button>

      <div class="flex-1" />
      <!--
        It throws away a whole page's worth, and a button that destructive
        belongs next to the thing that produced them.
      -->
      <button
        v-if="pageId && pool.length"
        type="button"
        class="route-btn"
        title="清掉這一頁所有 OCR 結果,讓下一次辨識從頭來過"
        @click="ocr.forget(pageId)"
      >
        <Trash2 :size="11" />
        <span>清空 OCR</span>
      </button>
    </div>

    <!--
      ⭐ Where the trip has got to, not a bar creeping to a number nobody
      promised. A page is minutes of work across six sets of weights; naming
      the station is what keeps that from reading as a hang.
    -->
    <p v-if="ocr.station" class="station">
      <template v-if="ocr.chapter">{{ ocr.chapter.pageId }} · </template>{{ ocr.station.name }}
      <span class="route-count">{{ ocr.station.at }}/{{ ocr.station.of }}</span>
    </p>
    <p v-else-if="ocr.problem" class="station station-bad">{{ ocr.problem }}</p>

    <div class="flex flex-wrap gap-1 px-2 pt-1 pb-2">
      <button
        v-for="px in GROW_STEPS"
        :key="px"
        type="button"
        class="route-btn"
        :disabled="!hasSelection"
        :title="`沿著選區的邊往外推 ${px} 像素，轉角是圓的`"
        @click="grow(px)"
      >
        選區 +{{ px }}px
      </button>
      <button
        type="button"
        class="route-btn"
        :disabled="!inpaint.canErase.value"
        title="把選區連同周邊送給 anime-manga-big-lama，回來的像素只寫進選區裡"
        @click="inpaint.eraseByModel()"
      >
        {{ inpaint.working.value ? '修補中…' : 'LaMa 修補' }}
      </button>
      <button
        type="button"
        class="route-btn"
        :aria-pressed="editor.textsHidden"
        :class="editor.textsHidden && 'route-btn-on'"
        title="畫布上暫時拿掉所有文字物件，看底下的圖。不改任何物件自己的顯示狀態，也不影響匯出"
        @click="editor.textsHidden = !editor.textsHidden"
      >
        {{ editor.textsHidden ? '顯示文字' : '隱藏文字' }}
      </button>
      <button
        type="button"
        class="route-btn"
        :aria-pressed="editor.showingOriginal"
        :class="editor.showingOriginal && 'route-btn-on'"
        title="畫布上只看最底下的底圖（原圖），其他圖層和文字都先拿掉。不改任何東西，也不影響匯出"
        @click="editor.showingOriginal = !editor.showingOriginal"
      >
        {{ editor.showingOriginal ? '回到作業' : '看原圖' }}
      </button>
      <PopoverRoot v-model:open="retouchSettingsOpen">
        <PopoverAnchor as-child>
          <button
            type="button"
            class="route-btn"
            :aria-pressed="retouchDimmed"
            :class="retouchDimmed && 'route-btn-on'"
            :disabled="!currentFile"
            :title="retouch.mode === 'hold'
              ? `按住時把叫「${project.retouchLayerNames.join('」「')}」的圖層換到另一個不透明度（${percent(retouch.low)}% / ${percent(retouch.high)}%），放開就回來，鎖住的也照改。右鍵打開設定`
              : `在 ${percent(retouch.low)}% 和 ${percent(retouch.high)}% 之間切換叫「${project.retouchLayerNames.join('」「')}」的圖層不透明度，鎖住的也照改，會跟著匯出。右鍵打開設定`"
            @click="retouch.mode === 'toggle' && toggleRetouch()"
            @pointerdown="onRetouchPress"
            @pointerup="endRetouchHold"
            @pointercancel="endRetouchHold"
            @lostpointercapture="endRetouchHold"
            @contextmenu.prevent="retouchSettingsOpen = true"
          >
            修圖 {{ percent(retouchDimmed ? retouch.low : retouch.high) }}%
          </button>
        </PopoverAnchor>
        <PopoverPortal>
          <PopoverContent class="retouch-options" side="bottom" align="end" :side-offset="6">
            <label class="retouch-row">
              <span>調淡時</span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                class="retouch-percent"
                :value="percent(retouch.low)"
                @change="onRetouchPercent('low', $event)"
              />
              %
            </label>
            <label class="retouch-row">
              <span>蓋住時</span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                class="retouch-percent"
                :value="percent(retouch.high)"
                @change="onRetouchPercent('high', $event)"
              />
              %
            </label>
            <div class="retouch-row">
              <span>按法</span>
              <label class="retouch-row" title="按一下換過去，再按一下換回來">
                <input
                  type="radio"
                  name="retouch-mode"
                  class="accent-primary"
                  :checked="retouch.mode === 'toggle'"
                  @change="preferences.setRetouchOpacity({ mode: 'toggle' })"
                />
                切換
              </label>
              <label class="retouch-row" title="按住的時候換過去，放開就換回來">
                <input
                  type="radio"
                  name="retouch-mode"
                  class="accent-primary"
                  :checked="retouch.mode === 'hold'"
                  @change="preferences.setRetouchOpacity({ mode: 'hold' })"
                />
                按住
              </label>
            </div>
            <label class="retouch-row" title="勾起來時切換整本每一頁，沒勾只改目前這頁">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-primary"
                :checked="retouch.wholeBook"
                @change="preferences.setRetouchOpacity({ wholeBook: ($event.target as HTMLInputElement).checked })"
              />
              整本
            </label>
            <label
              class="retouch-row"
              :class="retouch.mode === 'hold' && 'cursor-not-allowed opacity-40'"
              :title="retouch.mode === 'hold' ? '按住放開就回到原本的值，沒有東西要記進 undo 歷史' : '勾起來時每一次切換都會記進 undo 歷史，可以用 Ctrl+Z 退回；沒勾就不記'"
            >
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-primary"
                :checked="retouch.undoable"
                :disabled="retouch.mode === 'hold'"
                @change="preferences.setRetouchOpacity({ undoable: ($event.target as HTMLInputElement).checked })"
              />
              錄入 undo 歷史
            </label>
            <p class="retouch-note">
              改的圖層：{{ project.retouchLayerNames.length ? `「${project.retouchLayerNames.join('」「')}」` : '沒有' }}，在圖層面板用 ☀ 指定
            </p>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { everyEntry } from '@shared/page/trees'
import { computed, ref } from 'vue'
import { LoaderCircle, ScanText, SquareDashed, Trash2 } from '@lucide/vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { useInpaintSelection } from '@/composables/useInpaintSelection'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** Five is the amount the notes settled on; one is for the edge that is nearly there. */
const GROW_STEPS = [1, 5] as const

const editor = useEditorStore()
const selection = useSelectionStore()
const inpaint = useInpaintSelection()
const project = useProjectStore()
const ocr = useOcrStore()
const preferences = usePreferencesStore()

const pageId = computed(() => editor.currentPageId)
const pool = computed(() => (pageId.value ? project.readingsOfPage(pageId.value) : []))
const currentFile = computed(() =>
  pageId.value ? (project.pageById(pageId.value) ?? null) : null,
)
const reading = computed(() => (pageId.value ? ocr.busy(pageId.value) : false))

function readPage() {
  const file = currentFile.value
  if (!file) return
  void ocr.readPage(file.pageId, file.pageDir, file.page.pageTree)
}

const hasSelection = computed(
  () => selection.bounds !== null && !isEmptyRect(selection.bounds),
)

/** The selection's box, or why there is nothing to act on. */
const standing = computed(() => {
  const bounds = selection.bounds
  if (bounds === null || isEmptyRect(bounds)) return '沒有選區'
  return `${bounds.w}×${bounds.h}`
})

function grow(px: number): void {
  const target = editor.maskTarget
  if (target === null) return
  selection.grow(target, px)
}

const retouch = computed(() => preferences.prefs.retouchOpacity)
const retouchSettingsOpen = ref(false)

/** The opacity the current page's 修圖 layers all share, or null when they differ or there are none. */
const retouchAt = computed(() => {
  const file = currentFile.value
  if (!file) return null
  const names = new Set(project.retouchLayerNames)
  const values = new Set(
    everyEntry(file.page)
      .filter((e) => e.kind === 'raster' && names.has(e.name))
      .map((e) => e.opacity),
  )
  return values.size === 1 ? [...values][0] : null
})

const retouchDimmed = computed(() => retouchAt.value === retouch.value.low)

function percent(opacity: number): number {
  return Math.round(opacity * 100)
}

function toggleRetouch(): void {
  const { low, high, wholeBook, undoable } = retouch.value
  const pages = wholeBook ? project.files.map((f) => f.pageId) : pageId.value ? [pageId.value] : []
  editor.cmdSetRetouchOpacity(pages, retouchDimmed.value ? high : low, { undoable })
}

let held: { pageId: string; id: string; opacity: number }[] | null = null

function onRetouchPress(e: PointerEvent): void {
  if (retouch.value.mode !== 'hold' || e.button !== 0 || held !== null) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const { low, high, wholeBook } = retouch.value
  const pages = wholeBook ? project.files.map((f) => f.pageId) : pageId.value ? [pageId.value] : []
  held = editor.cmdSetRetouchOpacity(pages, retouchDimmed.value ? high : low, { undoable: false })
}

function endRetouchHold(): void {
  if (held === null) return
  for (const { pageId: page, id, opacity } of held) project.setLayerOpacity(page, id, opacity)
  held = null
}

function onRetouchPercent(which: 'low' | 'high', e: Event): void {
  const input = e.target as HTMLInputElement
  if (!Number.isNaN(input.valueAsNumber)) {
    preferences.setRetouchOpacity({ [which]: Math.round(input.valueAsNumber) / 100 })
  }
  input.value = String(percent(retouch.value[which]))
}
</script>

<style scoped>
.probe-head {
  display: flex;
  height: 1.75rem;
  align-items: center;
  padding-left: 0.375rem;
  user-select: none;
}
.route-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0.125rem 0.375rem;
  font-size: 12px;
  color: var(--muted-foreground);
}
.route-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.route-btn:disabled {
  opacity: 0.5;
}
.route-btn-go {
  color: var(--foreground);
}
/* On means its boxes are on the artwork, so the switch wears the colour it
   draws them in — the legend and the switch are the same object. */
.route-btn-boxes {
  border-color: oklch(0.65 0.19 285);
  background: color-mix(in srgb, oklch(0.65 0.19 285) 16%, transparent);
  color: var(--foreground);
}
.route-count {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.station {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem 0;
  font-size: 12px;
  color: var(--muted-foreground);
}
.station-bad {
  color: oklch(0.55 0.2 25);
}
.route-btn-on,
.route-btn-on:hover:not(:disabled) {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 14%, transparent);
  color: var(--foreground);
}
</style>

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.retouch-options {
  z-index: 50;
  display: flex;
  width: 14rem;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 0.8125rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.retouch-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.retouch-row > span {
  flex: 1;
}
.retouch-percent {
  width: 4rem;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  background: var(--background);
  padding: 1px 4px;
  text-align: right;
}
.retouch-note {
  font-size: 12px;
  color: var(--muted-foreground);
}
</style>
