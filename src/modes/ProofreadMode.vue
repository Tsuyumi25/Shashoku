<template>
  <div class="flex h-full">
    <!-- 左:sidebar——PPT 式頁面縮圖列表(點縮圖開該頁);底部 mode 切換 -->
    <aside
      class="flex shrink-0 flex-col gap-1 border-r border-border bg-card p-2 select-none"
      style="width: var(--layout-sidebar-w)"
    >
      <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">頁面</div>
      <ul
        v-if="project.files.length"
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
      >
        <li v-for="(f, i) in project.files" :key="f.filename">
          <button
            :ref="(el) => setThumbEl(f.filename, el)"
            class="relative block w-full overflow-hidden rounded border-2 transition-colors"
            :class="
              f.filename === currentPage ? 'border-primary' : 'border-transparent hover:border-border'
            "
            :title="f.filename"
            @click="editorStore.selectFile(f.filename)"
          >
            <img
              :src="thumbSrc(f.filename)"
              loading="lazy"
              draggable="false"
              class="block w-full select-none"
            />
            <span class="thumb-num">{{ i + 1 }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="px-1 text-[11px] text-muted-foreground">到「翻譯」頁開啟工程。</p>
      <ModeSwitcher class="mt-auto" />
    </aside>

    <!-- 中:compare 雙 pane + 底部列 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <div
        class="relative flex min-h-0 flex-1 select-none overflow-hidden"
        :class="panning ? 'cursor-grabbing' : spaceDown ? 'cursor-grab' : 'cursor-default'"
        style="touch-action: none"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <template v-if="currentPage">
          <img ref="imgRef" :src="src" class="hidden" @load="onImageLoad" />
          <div
            ref="paneEl"
            class="relative min-w-0 flex-1 overflow-hidden border-r border-border bg-muted"
            @wheel.prevent="wheelZoom"
          >
            <canvas ref="leftCanvasEl" class="absolute inset-0 h-full w-full" />
            <span class="pane-tag">原圖</span>
          </div>
          <div class="relative min-w-0 flex-1 overflow-hidden bg-muted" @wheel.prevent="wheelZoom">
            <!-- 成品 pane:文字節點住在這個 canvas 的 fallback(layoutsubtree),
                 與嵌字/匯出同一排版源 -->
            <canvas ref="rightCanvasEl" class="absolute inset-0 h-full w-full" layoutsubtree>
              <div
                v-for="l in textLabels"
                :key="l.id"
                :ref="(el) => setTextEl(l.id, el)"
                :style="cssForLabel(l)"
              >{{ l.text }}</div>
            </canvas>
            <span class="pane-tag">成品</span>
            <span
              v-if="degraded"
              class="absolute bottom-2 left-2 rounded px-2 py-1 text-[11px]"
              style="background: var(--card); color: var(--muted-foreground)"
            >
              此頁尚未在嵌字 mode 開啟:顯示原圖+文字投影(無去字/筆刷/網點)
            </span>
          </div>
        </template>
        <div
          v-else
          class="flex flex-1 items-center justify-center bg-muted text-sm text-muted-foreground"
        >
          到「翻譯」頁開啟工程,這裡對照原圖與嵌字成品。
        </div>
      </div>
      <CanvasBottomBar :scale="view.scale" @zoom-by="zoomBy" @fit="refit" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import ModeSwitcher from '@/components/ModeSwitcher.vue'
import { useZoomPan } from '@/composables/useZoomPan'
import { useEditor } from '@/editor/useEditor'
import { appMode } from '@/lib/appMode'
import { drawLabelElement } from '@/lib/labelPaint'
import { effectiveStyleForLabel, labelTextCss } from '@/lib/labelTextStyle'
import type { LabelItem } from '@/types/project'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { imageSrc } from '@/utils/mediaUrls'

const project = useProjectStore()
const editorStore = useEditorStore()
const engine = useEditor() // 嵌字引擎單例:doc + docPage = 成品像素的來源

const currentPage = computed(() => editorStore.currentFilename) // 頁游標全域共享
const src = computed(() =>
  project.rawsDir && currentPage.value ? imageSrc(project.rawsDir, currentPage.value) : '',
)
const currentLabels = computed<LabelItem[]>(() =>
  currentPage.value ? (project.fileByName(currentPage.value)?.labels ?? []) : [],
)
const textLabels = computed(() => currentLabels.value.filter((l) => l.text !== ''))
function cssForLabel(label: LabelItem): Record<string, string> {
  return labelTextCss(effectiveStyleForLabel(label, project.header))
}

const paneEl = useTemplateRef('paneEl')
const imgRef = useTemplateRef('imgRef')
const leftCanvasEl = useTemplateRef('leftCanvasEl')
const rightCanvasEl = useTemplateRef('rightCanvasEl')

const natural = ref({ w: 0, h: 0 })
const imageReady = ref(false)
const paneSize = ref({ w: 0, h: 0 })
useResizeObserver(paneEl, (entries) => {
  const { width, height } = entries[0].contentRect
  paneSize.value = { w: width, h: height }
  scheduleRedraw()
})

// 校對自己的 view(不掛 sharedView):compare 的 pane 是半寬,與另兩個
// mode 的全寬容器不同構,繼承全寬座標沒有幾何意義。兩個 pane 共用這份
// 本地 view = 左右天然同步。
const { view, fitToView, wheelZoom, zoomBy, panBy } = useZoomPan(paneSize, natural)

/** doc 屬於當前頁才可用(否則是嵌字側還停在別頁的像素)。 */
const docUsable = computed(
  () =>
    engine.doc.value !== null &&
    engine.docPage.value !== null &&
    engine.docPage.value === currentPage.value,
)
const degraded = computed(() => imageReady.value && !docUsable.value)

const textEls = new Map<string, HTMLElement>()
function setTextEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) textEls.set(id, el)
  else textEls.delete(id)
}

// ---- 頁面縮圖列表(PPT 式):點縮圖 = 移動全域頁游標 ----
function thumbSrc(filename: string): string {
  return project.rawsDir ? imageSrc(project.rawsDir, filename) : ''
}

const thumbEls = new Map<string, HTMLElement>()
function setThumbEl(name: string, el: unknown): void {
  if (el instanceof HTMLElement) thumbEls.set(name, el)
  else thumbEls.delete(name)
}
// 換頁(含底部列/快捷鍵觸發)時讓當前頁縮圖保持在可視範圍
watch(
  () => currentPage.value,
  (p) => {
    if (!p) return
    void nextTick(() => thumbEls.get(p)?.scrollIntoView({ block: 'nearest' }))
  },
)

// ---- 重繪(rAF + 髒標記;paint record 未就緒等兩幀重試,同嵌字形狀)----
let redrawScheduled = false
function scheduleRedraw(): void {
  if (redrawScheduled) return
  redrawScheduled = true
  requestAnimationFrame(() => {
    redrawScheduled = false
    redraw()
  })
}
let retryPending = false
function retryRedraw(): void {
  if (retryPending) return
  retryPending = true
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      retryPending = false
      scheduleRedraw()
    }),
  )
}

/** pane canvas 的每幀前置:對齊 backing store、清空、套 view 變換。 */
function preparePane(cv: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const g = cv.getContext('2d')
  if (!g) return null
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(paneSize.value.w * dpr))
  const h = Math.max(1, Math.round(paneSize.value.h * dpr))
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, cv.width, cv.height)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.translate(view.tx, view.ty)
  g.scale(view.scale, view.scale)
  g.imageSmoothingEnabled = view.scale < 3
  g.imageSmoothingQuality = view.scale < 1 ? 'high' : 'low'
  return g
}

function redraw(): void {
  if (appMode.value !== 'proofread') return // 隱藏中 paint record 不可用
  const img = imgRef.value
  const lc = leftCanvasEl.value
  const rc = rightCanvasEl.value
  if (!img || !lc || !rc || !imageReady.value) return

  const lg = preparePane(lc)
  if (lg) lg.drawImage(img, 0, 0)

  const rg = preparePane(rc)
  if (rg) {
    const d = docUsable.value ? engine.doc.value : null
    if (d) d.compositeInto(rg)
    else rg.drawImage(img, 0, 0)
    // 文字一律畫最上層。已知限制:錨定夾層(labelAnchors)是嵌字 mode 的
    // runtime 私有狀態,校對側看不到「文字被上層圖層蓋住」——等 D7
    // (圖層/錨定入 SSOT)落地後接上
    for (const l of textLabels.value) {
      const el = textEls.get(l.id)
      if (!el) continue
      if (!drawLabelElement(rg, el, l.x * natural.value.w, l.y * natural.value.h)) retryRedraw()
    }
  }
}

// 每頁自動 fit 一次(view 是本地的,不與其他 mode 互染)
let fitPage: string | null = null
function tryAutoFit(): void {
  if (appMode.value !== 'proofread' || !imageReady.value) return
  const page = currentPage.value
  if (page !== null && fitPage !== page && fitToView()) fitPage = page
}

function refit(): void {
  if (fitToView()) fitPage = currentPage.value
  scheduleRedraw()
}

function onImageLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  imageReady.value = true
  tryAutoFit()
  scheduleRedraw()
}

watch(
  () => currentPage.value,
  () => {
    imageReady.value = false
    scheduleRedraw()
  },
)
// 切進校對:隱藏期標籤節點沒有 paint record,fit + 等兩幀補繪
watch(appMode, (m) => {
  if (m === 'proofread') {
    tryAutoFit()
    scheduleRedraw()
    retryRedraw()
  }
})
watch(view, scheduleRedraw)
// 標籤/樣式變更:先畫(位置即時),再等兩幀補新 paint record。
// header deep watch 涵蓋 groups[].style 與 defaultStyle 變動;per-label
// effective style 只在渲染時解析,不需再獨立 computed
watch(
  [currentLabels, () => project.header],
  () => {
    scheduleRedraw()
    retryRedraw()
  },
  { deep: true, flush: 'post' },
)
// 嵌字側的像素/圖層變更與 doc 換頁 → 成品側重畫
watch([engine.layersTick, engine.docPage], scheduleRedraw)

// ---- pan(Space 按住 + 拖,全視圖統一手勢;中鍵拖曳同嵌字)----
const spaceDown = ref(false)
const panning = ref(false)
let panLast = { x: 0, y: 0 }
function onPointerDown(e: PointerEvent): void {
  if (!(e.button === 1 || (e.button === 0 && spaceDown.value))) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  panning.value = true
  panLast = { x: e.clientX, y: e.clientY }
}
function onPointerMove(e: PointerEvent): void {
  if (!panning.value) return
  panBy(e.clientX - panLast.x, e.clientY - panLast.y)
  panLast = { x: e.clientX, y: e.clientY }
}
function onPointerUp(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  panning.value = false
}

// ---- 鍵盤:0 = fit、←/→/Tab 換頁、Space 按住 pan、Esc 連按 = 重置視角 ----
let lastEscAt = 0
useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'proofread') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (el instanceof HTMLSelectElement) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.code === 'Space') {
    spaceDown.value = true
    e.preventDefault()
  } else if (e.key === '0') refit()
  else if (e.key === 'ArrowLeft') editorStore.pageBy(-1)
  else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
    // Shift+Tab 留給 AppShell 的 mode 循環
    e.preventDefault()
    editorStore.pageBy(1)
  } else if (e.key === 'Escape') {
    const now = performance.now()
    const isDouble = now - lastEscAt < 400
    lastEscAt = isDouble ? 0 : now
    if (isDouble) refit()
  }
})

// keyup 不 guard mode:切走前按住的 Space 要能歸零
useEventListener(window, 'keyup', (e) => {
  if (e.code === 'Space') spaceDown.value = false
})
</script>

<style scoped>
.thumb-num {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  border-radius: 0.25rem;
  background: var(--card);
  padding: 0 0.375rem;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
  opacity: 0.9;
}
.pane-tag {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  border-radius: 0.25rem;
  background: var(--card);
  padding: 0.125rem 0.5rem;
  font-size: 11px;
  color: var(--muted-foreground);
  opacity: 0.9;
}
</style>
