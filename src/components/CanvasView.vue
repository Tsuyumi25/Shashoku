<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      ref="containerRef"
      class="relative min-h-0 w-full flex-1 touch-none overflow-hidden bg-muted"
      :class="[canvasCursor]"
      @wheel.prevent="wheelZoom"
      @pointerdown="onBgPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onBgPointerUp"
      @pointercancel="onBgPointerUp"
      @contextmenu.prevent
      @auxclick="onAuxClick"
    >
      <template v-if="currentFile && !currentFile.missing">
        <!-- 底圖:視口 canvas + ctx transform(與嵌字同一條渲染路)。
             CSS transform 縮小 <img> 走 Chromium 的 mipmap 平滑,fit 倍率下
             明顯偏糊;canvas 畫「高品質預縮版」+ 殘餘 bilinear,銳而不混疊。
             img 藏起來只當解碼源 -->
        <img ref="imgRef" :src="src" class="hidden" @load="onImageLoad" />
        <canvas ref="baseCanvasRef" class="pointer-events-none absolute inset-0 h-full w-full" />
        <!-- stage:marker 與文字投影同在一個 transform 容器內(輕量 DOM) -->
        <div class="absolute top-0 left-0" :style="stageStyle">
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
              :rotate="view.rotate"
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

    <!-- 底部列：縮放 + 檔案切換(兩視圖共用元件,對齊原版 toolStripPicView) -->
    <CanvasBottomBar :scale="view.scale" @zoom-by="zoomBy" @fit="fitToView" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import type { LabelItem } from '@/types/project'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import LabelTextOverlay from '@/components/LabelTextOverlay.vue'
import LabelMarker from '@/components/LabelMarker.vue'
import { labelTextStyleFromExportConfig } from '@/lib/labelTextStyle'
import { useZoomPan } from '@/composables/useZoomPan'
import { appMode } from '@/lib/appMode'
import { clamp, screenToContentPx } from '@/lib/coords'
import { sharedView, viewFit } from '@/lib/viewState'
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
  scheduleBaseDraw()
})

// ---- 底圖繪製(視口 canvas,rAF + 髒標記,同嵌字 mode 的重繪形狀)----
//
// 縮小檢視的採樣品質用 imageSmoothingQuality 'high'(Chromium 對同一張
// 圖快取 mip,逐幀成本無感):單步 bilinear 在大幅縮小時混疊(細線忽粗
// 忽細、網點摩爾紋,實測條紋不均度 78→39),CSS transform 縮 <img> 的
// mipmap 又過糊(高頻能量只剩 51%,'high' 有 86%)。只動顯示:標籤
// 資料/匯出與這條路無關。
const imgRef = useTemplateRef('imgRef')
const baseCanvasRef = useTemplateRef('baseCanvasRef')

let baseDrawScheduled = false
function scheduleBaseDraw() {
  if (baseDrawScheduled) return
  baseDrawScheduled = true
  requestAnimationFrame(() => {
    baseDrawScheduled = false
    drawBase()
  })
}

function drawBase() {
  const cv = baseCanvasRef.value
  if (!cv) return
  const g = cv.getContext('2d')
  if (!g) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(containerSize.value.w * dpr))
  const h = Math.max(1, Math.round(containerSize.value.h * dpr))
  // v-if 重新掛載時 RO 不會補發,backing store 尺寸在每次繪製時對齊
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, cv.width, cv.height)
  const img = imgRef.value
  if (!img || !imageReady.value) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.translate(view.tx, view.ty)
  g.scale(view.scale, view.scale)
  g.rotate(view.rotate)
  g.imageSmoothingEnabled = view.scale < 3 // 高倍看像素格,同嵌字
  g.imageSmoothingQuality = view.scale < 1 ? 'high' : 'low'
  g.drawImage(img, 0, 0)
}

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

// 視角是全域狀態(sharedView):與嵌字 mode 共用,切視圖繼承座標與縮放
const { view, fitToView, wheelZoom, zoomBy, panBy, rotateTo } = useZoomPan(
  containerSize,
  natural,
  sharedView,
)
const panning = ref(false)

// view 變更(pan/zoom/rotate,含另一 mode 調整後切回)與載圖 → 重繪底圖
// (drawBase 尾端自己追預縮版級距)
watch(view, scheduleBaseDraw)
watch(imageReady, scheduleBaseDraw)

// R 按住 = 旋轉視角(spring-loaded,與嵌字 mode 同手勢);輕點 R(按下放開
// 沒拖曳)= 切檢查模式——R 在翻譯 mode 一鍵兩用,靠「有沒有旋轉」分流
const rDown = ref(false)
const rotating = ref(false)
let didRotate = false
let rotatePivot = { x: 0, y: 0 }
let rotateStartAngle = 0
let rotateStartTheta = 0
let lastEscAt = 0 // Esc 連按偵測(雙擊窗 400ms)= 視角重置,同嵌字 mode

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
  if (rotating.value || rDown.value) return 'cursor-grab'
  if (labelModeActive.value) return 'cursor-crosshair'
  return 'cursor-default'
})

watch(
  () => currentFile.value?.filename,
  () => {
    imageReady.value = false
    scheduleBaseDraw()
  },
)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  imageReady.value = true
  // 自動 fit 走 viewFit 守門:換頁重 fit、切視圖繼承。隱藏側的 load
  // (v-show 不擋 img 載入)容器 0×0,fitToView 自動 no-op 不污染視角
  const page = editor.currentFilename
  if (viewFit.page !== page && fitToView()) viewFit.page = page
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

/** 背景 pointerdown：R 按住 = 旋轉;拖 = pan;標號模式下短按 = 新增 label */
let bgDownPos: { x: number; y: number } | null = null
let panLast = { x: 0, y: 0 }
function onBgPointerDown(e: PointerEvent) {
  if (rDown.value) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    rotating.value = true
    didRotate = true
    const rect = containerRef.value!.getBoundingClientRect()
    rotatePivot = { x: rect.width / 2, y: rect.height / 2 }
    rotateStartAngle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    rotateStartTheta = view.rotate
    return
  }
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  bgDownPos = { x: e.clientX, y: e.clientY }
  panning.value = true
  panLast = { x: e.clientX, y: e.clientY }
}
function onPointerMove(e: PointerEvent) {
  if (rotating.value) {
    const rect = containerRef.value!.getBoundingClientRect()
    const ang = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    let theta = rotateStartTheta + (ang - rotateStartAngle)
    if (e.shiftKey) theta = Math.round(theta / (Math.PI / 12)) * (Math.PI / 12) // 吸附 15°
    rotateTo(theta, rotatePivot.x, rotatePivot.y)
    return
  }
  if (!panning.value) return
  panBy(e.clientX - panLast.x, e.clientY - panLast.y)
  panLast = { x: e.clientX, y: e.clientY }
}
function onBgPointerUp(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  if (rotating.value) {
    rotating.value = false
    return
  }
  const isClick =
    bgDownPos && Math.hypot(e.clientX - bgDownPos.x, e.clientY - bgDownPos.y) < DRAG_THRESHOLD_PX
  bgDownPos = null
  panning.value = false
  if (isClick && labelModeActive.value) addLabelAt(e.clientX, e.clientY)
}

let dragging: {
  id: string
  filename: string
  startX: number
  startY: number
  /** 拖曳起點的內容座標(px)——位移經 screenToContentPx 差分,旋轉視角下才正確 */
  startContent: { x: number; y: number }
  oldPos: { x: number; y: number }
  moved: boolean
} | null = null

function onMarkerPointerDown(label: LabelItem, e: PointerEvent) {
  const file = currentFile.value
  if (!file || e.button !== 0 || !containerRef.value) return
  editor.selectedLabelId = label.id
  if (labelModeActive.value) {
    // 標號模式：準備拖曳移動
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const rect = containerRef.value.getBoundingClientRect()
    dragging = {
      id: label.id,
      filename: file.filename,
      startX: e.clientX,
      startY: e.clientY,
      startContent: screenToContentPx(e.clientX, e.clientY, rect, view),
      oldPos: { x: label.x, y: label.y },
      moved: false,
    }
  } else {
    // 瀏覽/錄入/檢查：選取 + 聚焦翻譯框（原版 textbox.Focus()）
    editor.requestEditorFocus()
  }
}

function onMarkerPointerMove(e: PointerEvent) {
  if (!dragging || !containerRef.value) return
  if (
    !dragging.moved &&
    Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) < DRAG_THRESHOLD_PX
  )
    return
  dragging.moved = true
  const rect = containerRef.value.getBoundingClientRect()
  const content = screenToContentPx(e.clientX, e.clientY, rect, view)
  project.moveLabel(
    dragging.filename,
    dragging.id,
    clamp(dragging.oldPos.x + (content.x - dragging.startContent.x) / natural.value.w, 0, 1),
    clamp(dragging.oldPos.y + (content.y - dragging.startContent.y) / natural.value.h, 0, 1),
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

// 畫布快捷鍵（輸入框聚焦時不攔）：0 適應視窗、←/→/Tab 換頁、
// R 按住旋轉、Esc 連按重置視角(同嵌字 mode)
useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'translate') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (el instanceof HTMLSelectElement) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  if (e.key === '0' && imageReady.value) fitToView()
  else if (e.key === 'ArrowLeft') editor.pageBy(-1)
  else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
    // Shift+Tab 留給 AppShell 的 mode 循環
    e.preventDefault()
    editor.pageBy(1)
  } else if (e.key.toLowerCase() === 'r') {
    if (!rDown.value) didRotate = false // 這輪按住尚未旋轉(key repeat 不重置)
    rDown.value = true
  } else if (e.key === 'Escape') {
    // 連按兩下 = 視角全重置(fitToView 含旋轉歸零);單按 + R 按住 = 只回正旋轉
    const now = performance.now()
    const isDouble = now - lastEscAt < 400
    lastEscAt = isDouble ? 0 : now
    if (isDouble && imageReady.value) {
      fitToView()
    } else if (rDown.value && containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      rotateTo(0, rect.width / 2, rect.height / 2)
    }
  }
})

// R 放開:輕點(按住期間沒旋轉)= 切檢查模式——QWER 裡的 R 移到這裡,
// 與「按住旋轉」共用一顆鍵。keyup 不 guard mode:切走前按住的 R 要能歸零
useEventListener(window, 'keyup', (e) => {
  if (e.key.toLowerCase() !== 'r') return
  const tapped = rDown.value && !didRotate
  rDown.value = false
  if (!tapped || appMode.value !== 'translate') return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  editor.mode = 'check'
})

const stageStyle = computed(() => ({
  width: `${natural.value.w}px`,
  height: `${natural.value.h}px`,
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${view.rotate}rad)`,
  transformOrigin: '0 0',
}))
</script>

