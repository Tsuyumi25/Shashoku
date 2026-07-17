<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      ref="containerRef"
      class="relative min-h-0 w-full flex-1 touch-none overflow-hidden"
      :class="[canvasCursor]"
      @wheel.prevent="onWheel"
      @pointerdown="onBgPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onBgPointerUp"
      @pointercancel="onBgPointerUp"
      @contextmenu.prevent
      @auxclick="onAuxClick"
    >
      <template v-if="currentFile && !currentFile.missing">
        <!-- stage：img 與所有 marker 同在一個 transform 容器內 -->
        <div class="absolute top-0 left-0" :style="stageStyle">
          <img
            :src="src"
            draggable="false"
            class="block max-w-none select-none"
            @load="onImageLoad"
          />
          <template v-if="imageReady">
            <LabelTextOverlay
              :width="natural.w"
              :height="natural.h"
              :labels="currentFile.labels"
              :text-style="textPreviewStyle"
            />
            <LabelMarker
              v-for="(label, i) in currentFile.labels"
              :key="label.id"
              :label
              :index="i"
              :scale="view.scale"
              :natural
              :selected="label.id === editor.selectedLabelId"
              :show-group="editor.mode === 'check'"
              :group-name="project.header.groups[label.category - 1] ?? `分組${label.category}`"
              @marker-pointerdown="onMarkerPointerDown(label, $event)"
              @marker-pointermove="onMarkerPointerMove($event)"
              @marker-pointerup="onMarkerPointerUp($event)"
              @marker-pointerenter="onMarkerPointerEnter(label)"
              @marker-contextmenu="onMarkerContextMenu(label, $event)"
            />
          </template>
        </div>
      </template>

      <div
        v-else
        class="flex h-full items-center justify-center text-sm text-muted-foreground select-none"
      >
        <template v-if="currentFile?.missing">圖檔不存在：{{ currentFile.filename }}</template>
        <template v-else-if="project.isOpen">底部選一張圖</template>
        <template v-else>開啟一個漫畫圖片資料夾開始工作</template>
      </div>
    </div>

    <!-- 底部列：縮放（左）＋ 檔案切換（右），對齊原版 toolStripPicView -->
    <div class="flex h-7 shrink-0 items-center gap-1 border-t border-border px-1 select-none">
      <button class="page-btn" title="縮小" @click="zoomBy(1 / 1.25)">
        <ZoomOut :size="14" />
      </button>
      <button class="page-btn" title="放大" @click="zoomBy(1.25)">
        <ZoomIn :size="14" />
      </button>
      <span class="px-1 text-xs text-muted-foreground tabular-nums">
        {{ Math.round(view.scale * 100) }}%
      </span>
      <button class="page-btn" title="適應視窗 (0)" @click="fitToView">
        <Maximize :size="13" />
      </button>

      <div class="flex-1" />

      <select
        class="h-5 max-w-64 min-w-0 rounded border border-input bg-background px-1 text-xs"
        :value="editor.currentFilename ?? ''"
        @change="onFileSelect"
      >
        <option v-for="f in project.files" :key="f.filename" :value="f.filename">
          {{ f.filename }}{{ f.labels.length > 0 ? `（${f.labels.length}）` : '' }}
        </option>
      </select>
      <button class="page-btn" title="上一頁 (←)" @click="editor.pageBy(-1)">
        <ChevronLeft :size="15" />
      </button>
      <button class="page-btn" title="下一頁 (→ / Tab / 中鍵)" @click="editor.pageBy(1)">
        <ChevronRight :size="15" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from '@lucide/vue'
import type { LabelItem } from '@/types/project'
import LabelTextOverlay from '@/components/LabelTextOverlay.vue'
import LabelMarker from '@/components/LabelMarker.vue'
import { labelTextStyleFromExportConfig } from '@/lib/labelTextStyle'
import { useZoomPan } from '@/composables/useZoomPanLp'
import { appMode } from '@/lib/appMode'
import { clamp, screenToContentPx } from '@/lib/coords'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { imageSrc } from '@/utils/mediaUrls'

const project = useProjectStore()
const editor = useEditorStore()
const textPreviewStyle = computed(() =>
  labelTextStyleFromExportConfig(project.exportConfig),
)

const containerRef = useTemplateRef('containerRef')
const containerSize = ref({ w: 0, h: 0 })
useResizeObserver(containerRef, (entries) => {
  const { width, height } = entries[0].contentRect
  containerSize.value = { w: width, h: height }
})

const natural = ref({ w: 0, h: 0 })
const imageReady = ref(false)

const currentFile = computed(() =>
  editor.currentFilename ? project.fileByName(editor.currentFilename) : undefined,
)
const src = computed(() =>
  project.folderPath && currentFile.value
    ? imageSrc(project.folderPath, currentFile.value.filename)
    : '',
)

const { view, panning, fitToView, onWheel, onPointerDown, onPointerMove, onPointerUp } =
  useZoomPan(containerSize, natural)

// 標號模式（或按住 Ctrl）游標 = 十字，對齊原版
const ctrlHeld = ref(false)
useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'translate') return
  if (e.key === 'Control') ctrlHeld.value = true
})
useEventListener(window, 'keyup', (e) => {
  if (e.key === 'Control') ctrlHeld.value = false // 放開不 guard:切 mode 前按住的要能歸零
})
const labelModeActive = computed(() => editor.mode === 'label' || ctrlHeld.value)
const canvasCursor = computed(() => {
  if (panning.value) return 'cursor-grabbing'
  if (labelModeActive.value) return 'cursor-crosshair'
  return 'cursor-default'
})

watch(
  () => currentFile.value?.filename,
  () => {
    imageReady.value = false
  },
)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  imageReady.value = true
  fitToView()
}

function onFileSelect(e: Event) {
  editor.selectFile((e.target as HTMLSelectElement).value)
}

function zoomBy(factor: number) {
  // 以視窗中心為錨點
  const cx = containerSize.value.w / 2
  const cy = containerSize.value.h / 2
  const next = clamp(view.scale * factor, 0.02, 40)
  const k = next / view.scale
  view.tx = cx - (cx - view.tx) * k
  view.ty = cy - (cy - view.ty) * k
  view.scale = next
}

/** 中鍵 = 下一頁（原版行為） */
function onAuxClick(e: MouseEvent) {
  if (e.button === 1) editor.pageBy(1)
}

// ── label 互動（模式化，對齊原版）──
// 標號模式（或 Ctrl）：單擊空白 = 新增、右鍵 marker = 刪除、拖曳 marker = 移動
// 其他模式：點 marker = 選取 + 聚焦翻譯框；檢查模式滑過 marker 即選取

const DRAG_THRESHOLD_PX = 3

function addLabelAt(clientX: number, clientY: number) {
  const file = currentFile.value
  if (!file || file.missing || !imageReady.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const content = screenToContentPx(clientX, clientY, rect, view)
  if (content.x < 0 || content.x > natural.value.w || content.y < 0 || content.y > natural.value.h)
    return
  editor.cmdAddLabel(file.filename, {
    id: crypto.randomUUID(),
    x: content.x / natural.value.w,
    y: content.y / natural.value.h,
    category: editor.activeCategory,
    text: '',
  })
}

/** 背景 pointerdown：拖 = pan；標號模式下短按 = 新增 label */
let bgDownPos: { x: number; y: number } | null = null
function onBgPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  bgDownPos = { x: e.clientX, y: e.clientY }
  onPointerDown(e)
}
function onBgPointerUp(e: PointerEvent) {
  const isClick =
    bgDownPos && Math.hypot(e.clientX - bgDownPos.x, e.clientY - bgDownPos.y) < DRAG_THRESHOLD_PX
  bgDownPos = null
  onPointerUp(e)
  if (isClick && labelModeActive.value) addLabelAt(e.clientX, e.clientY)
}

let dragging: {
  id: string
  filename: string
  startX: number
  startY: number
  oldPos: { x: number; y: number }
  moved: boolean
} | null = null

function onMarkerPointerDown(label: LabelItem, e: PointerEvent) {
  const file = currentFile.value
  if (!file || e.button !== 0) return
  editor.selectedLabelId = label.id
  if (labelModeActive.value) {
    // 標號模式：準備拖曳移動
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging = {
      id: label.id,
      filename: file.filename,
      startX: e.clientX,
      startY: e.clientY,
      oldPos: { x: label.x, y: label.y },
      moved: false,
    }
  } else {
    // 瀏覽/錄入/檢查：選取 + 聚焦翻譯框（原版 textbox.Focus()）
    editor.requestEditorFocus()
  }
}

function onMarkerPointerMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - dragging.startX
  const dy = e.clientY - dragging.startY
  if (!dragging.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
  dragging.moved = true
  project.moveLabel(
    dragging.filename,
    dragging.id,
    clamp(dragging.oldPos.x + dx / view.scale / natural.value.w, 0, 1),
    clamp(dragging.oldPos.y + dy / view.scale / natural.value.h, 0, 1),
  )
}

function onMarkerPointerUp(e: PointerEvent) {
  if (!dragging) return
  if (dragging.moved) {
    const label = project.fileByName(dragging.filename)?.labels.find((l) => l.id === dragging!.id)
    if (label) {
      editor.cmdMoveLabel(dragging.filename, dragging.id, dragging.oldPos, {
        x: label.x,
        y: label.y,
      })
    }
  }
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  dragging = null
}

/** 檢查模式：滑過 marker 即選取（原版 mouseIndexChanged） */
function onMarkerPointerEnter(label: LabelItem) {
  if (editor.mode === 'check') editor.selectedLabelId = label.id
}

/** 標號模式（或 Ctrl）右鍵 marker = 刪除（可 undo，不確認） */
function onMarkerContextMenu(label: LabelItem, e: MouseEvent) {
  e.preventDefault()
  if (!labelModeActive.value || !currentFile.value) return
  editor.cmdDeleteLabel(currentFile.value.filename, label.id)
}

// 畫布快捷鍵（輸入框聚焦時不攔）：0 適應視窗、←/→/Tab 換頁
useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'translate') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (el instanceof HTMLSelectElement) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  if (e.key === '0' && imageReady.value) fitToView()
  else if (e.key === 'ArrowLeft') editor.pageBy(-1)
  else if (e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault()
    editor.pageBy(1)
  }
})

const stageStyle = computed(() => ({
  width: `${natural.value.w}px`,
  height: `${natural.value.h}px`,
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
  transformOrigin: '0 0',
}))
</script>

<style scoped>
.page-btn {
  display: flex;
  height: 1.25rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.page-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
