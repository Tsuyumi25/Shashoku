<template>
  <!--
    Not in the tool rail because it is not a tool: nothing is armed by pressing
    it. It is an action, which is what this board holds.
  -->
  <div class="shrink-0 border-b border-border">
    <div class="board-head">
      <span class="text-xs font-medium">辨識</span>
    </div>

    <div class="p-2">
      <div class="flex flex-wrap items-center gap-1">
        <!--
          ⭐ One button, because every reader is asked every time. Four buttons
          made "how many models agree" depend on which ones somebody happened to
          press, which is the number the page's own decision leans on hardest.
        -->
        <button
          type="button"
          class="route-btn route-btn-go"
          :disabled="running || !currentFile"
          title="兩個偵測器找出哪裡有字，量出每個區域怎麼排，四個辨識器每一個都被問"
          @click="press"
        >
          <LoaderCircle v-if="running" :size="12" class="animate-spin" />
          <ScanText v-else :size="12" />
          <span>辨識本頁</span>
          <span v-if="pool.length" class="route-count">{{ pool.length }}</span>
        </button>

        <button
          v-if="pageId && pool.length"
          type="button"
          class="route-btn"
          :class="[ocr.showing(pageId) && 'route-btn-on']"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { LoaderCircle, ScanText, SquareDashed, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useOcrStore } from '@/stores/ocrStore'
import { useProjectStore } from '@/stores/projectStore'

const editor = useEditorStore()
const project = useProjectStore()
const ocr = useOcrStore()

const pageId = computed(() => editor.currentPageId)

const pool = computed(() => (pageId.value ? project.readingsOfPage(pageId.value) : []))

const currentFile = computed(() =>
  pageId.value ? (project.pageById(pageId.value) ?? null) : null,
)

const running = computed(() => (pageId.value ? ocr.busy(pageId.value) : false))

function press() {
  const file = currentFile.value
  if (!file) return
  void ocr.readPage(file.pageId, file.pageDir, file.page.layers)
}
</script>

<style scoped>
.board-head {
  display: flex;
  height: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-left: 0.5rem;
  user-select: none;
}

.route-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0.125rem 0.375rem;
  font-size: 11px;
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
.route-btn-on {
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
  margin-top: 0.375rem;
  font-size: 11px;
  color: var(--muted-foreground);
}
.station-bad {
  color: oklch(0.55 0.2 25);
}
</style>
