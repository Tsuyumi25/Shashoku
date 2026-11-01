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
        :disabled="reading || !currentFile"
        title="兩個偵測器找出哪裡有字，量出每個區域怎麼排，四個辨識器每一個都被問"
        @click="readPage"
      >
        <LoaderCircle v-if="reading" :size="12" class="animate-spin" />
        <ScanText v-else :size="12" />
        <span>辨識本頁</span>
        <span v-if="pool.length" class="route-count">{{ pool.length }}</span>
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
      {{ ocr.station.name }}
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
      <button
        v-for="opacity in RETOUCH_OPACITIES"
        :key="opacity"
        type="button"
        class="route-btn"
        :class="retouchAt === opacity && 'route-btn-on'"
        :disabled="!currentFile"
        :title="`把叫「${project.retouchLayerNames.join('」「')}」的圖層不透明度設成 ${Math.round(opacity * 100)}%，鎖住的也照改。會跟著匯出；圖層面板的 ☀ 決定是哪幾層`"
        @click="setRetouchOpacity(opacity)"
      >
        修圖{{ Math.round(opacity * 100) }}%
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-3 px-2 pb-2 text-[12px] text-muted-foreground">
      <label class="flex items-center gap-1.5" title="勾起來時修圖按鈕改整本每一頁，沒勾只改目前這頁">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="preferences.prefs.retouchOpacity.wholeBook"
          @change="preferences.setRetouchOpacity({ wholeBook: ($event.target as HTMLInputElement).checked })"
        />
        整本
      </label>
      <label class="flex items-center gap-1.5" title="勾起來時修圖按鈕的每一次切換都可以復原，沒勾就不進復原歷史">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="preferences.prefs.retouchOpacity.undoable"
          @change="preferences.setRetouchOpacity({ undoable: ($event.target as HTMLInputElement).checked })"
        />
        可復原
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { LoaderCircle, ScanText, SquareDashed, Trash2 } from '@lucide/vue'
import { useInpaintSelection } from '@/composables/useInpaintSelection'
import { isEmptyRect } from '@/lib/selection/rect'
import { allEntries } from '@shared/page/tree'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** Five is the amount the notes settled on; one is for the edge that is nearly there. */
const GROW_STEPS = [1, 5] as const
const RETOUCH_OPACITIES = [0.4, 1] as const

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
  void ocr.readPage(file.pageId, file.pageDir, file.page.layers)
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

/** The opacity the current page's 修圖 layers all share, or null when they differ or there are none. */
const retouchAt = computed(() => {
  const file = currentFile.value
  if (!file) return null
  const names = new Set(project.retouchLayerNames)
  const values = new Set(
    allEntries(file.page.layers)
      .filter((e) => e.kind === 'raster' && names.has(e.name))
      .map((e) => e.opacity),
  )
  return values.size === 1 ? [...values][0] : null
})

function setRetouchOpacity(opacity: number): void {
  const { wholeBook, undoable } = preferences.prefs.retouchOpacity
  const pages = wholeBook ? project.files.map((f) => f.pageId) : pageId.value ? [pageId.value] : []
  editor.cmdSetRetouchOpacity(pages, opacity, { undoable })
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
