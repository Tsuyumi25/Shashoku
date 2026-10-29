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
        type="button"
        class="route-btn"
        :disabled="!hasSelection"
        title="沿著選區的邊往外推 5 像素，轉角是圓的"
        @click="growBy5"
      >
        選區 +5px
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { LoaderCircle, ScanText, SquareDashed, Trash2 } from '@lucide/vue'
import { useInpaintSelection } from '@/composables/useInpaintSelection'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** What the probe was written to try. Five is the amount the notes settled on. */
const GROW_PX = 5

const editor = useEditorStore()
const selection = useSelectionStore()
const inpaint = useInpaintSelection()
const project = useProjectStore()
const ocr = useOcrStore()

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

function growBy5(): void {
  const target = editor.maskTarget
  if (target === null) return
  selection.grow(target, GROW_PX)
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
