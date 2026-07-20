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
      @dragover="onLabelDragOver"
      @drop="onLabelDrop"
      @contextmenu.prevent
      @auxclick="onAuxClick"
    >
      <template v-if="currentFile && currentFile.badge === 'ok'">
        <!-- 底圖:視口 canvas + ctx transform(與嵌字同一條渲染路)。
             CSS transform 縮小 <img> 走 Chromium 的 mipmap 平滑,fit 倍率下
             明顯偏糊;canvas 畫「高品質預縮版」+ 殘餘 bilinear,銳而不混疊。
             img 藏起來只當解碼源 -->
        <img ref="imgRef" :src="src" class="hidden" @load="onImageLoad" />
        <canvas ref="baseCanvasRef" class="pointer-events-none absolute inset-0 h-full w-full" />
        <!-- stage:marker 與文字投影同在一個 transform 容器內(輕量 DOM) -->
        <div class="absolute top-0 left-0" :style="stageStyle">
          <template v-if="imageReady">
            <!-- Space 按住 = pan 手勢:標籤/marker 全部穿透,事件一律落到背景 -->
            <LabelTextOverlay
              :width="natural.w"
              :height="natural.h"
              :labels="currentFile.labels"
              :text-style="textPreviewStyle"
              :interactive="!spaceDown"
              :hidden-label-id="hiddenNativeMoveId"
              :native-draggable="!spaceDown"
              @select="(id) => (editor.selectedLabelId = id)"
              @label-pointerdown="onNativeLabelPointerDown"
              @label-dragstart="onNativeLabelDragStart"
              @label-dragend="onNativeLabelDragEnd"
              @edit="
                (id) => {
                  editor.selectedLabelId = id
                  editor.requestEditorFocus()
                }
              "
            />
            <LabelMarker
              v-for="(label, i) in currentFile.labels"
              :key="label.id"
              :class="[
                spaceDown && 'pointer-events-none',
                label.id === hiddenNativeMoveId && 'opacity-0',
              ]"
              :label
              :index="i"
              :scale="view.scale"
              :rotate="view.rotate"
              :natural
              :selected="label.id === editor.selectedLabelId"
              :show-group="editor.showGroups"
              :group-name="project.header.groups[label.category - 1] ?? `分組${label.category}`"
              :native-draggable="!spaceDown"
              @marker-pointerdown="onMarkerPointerDown(label, $event)"
              @marker-dblclick="editor.requestEditorFocus()"
              @marker-contextmenu="onMarkerContextMenu(label, $event)"
              @marker-dragstart="onNativeLabelDragStart(label, $event)"
              @marker-dragend="onNativeLabelDragEnd"
            />
          </template>
        </div>
      </template>

      <div
        v-else
        class="flex h-full items-center justify-center text-sm text-muted-foreground select-none"
      >
        <template v-if="currentFile && currentFile.badge !== 'ok'">圖檔不存在：{{ currentFile.filename }}</template>
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
import { clamp, contentToScreenPx, screenToContentPx } from '@/lib/coords'
import { sharedView, viewFit } from '@/lib/viewState'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { imageSrc } from '@/utils/mediaUrls'
import { setLabelDragPreview } from '@/lib/labelDragPreview'
import {
  LABEL_DRAG_TYPE,
  parseLabelDrag,
  resolveDropCategory,
  serializeLabelDrag,
  type LabelDragPayload,
} from '@/lib/labelDrag'

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

// R 按住 = 旋轉視角(spring-loaded,與嵌字 mode 同手勢)
const rDown = ref(false)
const rotating = ref(false)
let rotatePivot = { x: 0, y: 0 }
let rotateStartAngle = 0
let rotateStartTheta = 0
let lastEscAt = 0 // Esc 連按偵測(雙擊窗 400ms)= 視角重置,同嵌字 mode

// V/T 雙工具(V 同 PS Move,T 同嵌字的文字工具):move = 點 marker 選取/
// 拖移、點空白取消選取,絕不創建;label = 點空白新增標號。
// pan 統一走 Space 按住 + 拖(全視圖同手勢)
const tool = ref<'move' | 'label'>('move')
const spaceDown = ref(false)
const canvasCursor = computed(() => {
  if (panning.value) return 'cursor-grabbing'
  if (rotating.value || rDown.value || spaceDown.value) return 'cursor-grab'
  return tool.value === 'label' ? 'cursor-crosshair' : 'cursor-default'
})

watch(
  () => currentFile.value?.filename,
  () => {
    imageReady.value = false
    scheduleBaseDraw()
  },
)

// 選中標籤變更(j/k、表格點選、Ctrl+Enter)→ 畫布自動跟蹤到標籤位置
// (原錄入模式的 SetLabelVisual 精髓,常駐化)。只 pan 不動 zoom;
// guard appMode:view 是 sharedView,隱藏側不可亂動另一 mode 的視角
const FOLLOW_MARGIN = 48
watch(
  () => editor.selectedLabelId,
  (id) => {
    if (appMode.value !== 'translate' || !id || !imageReady.value || !containerRef.value) return
    const label = currentFile.value?.labels.find((l) => l.id === id)
    if (!label) return
    const rect = containerRef.value.getBoundingClientRect()
    const p = contentToScreenPx(label.x * natural.value.w, label.y * natural.value.h, view)
    if (
      p.x < FOLLOW_MARGIN ||
      p.x > rect.width - FOLLOW_MARGIN ||
      p.y < FOLLOW_MARGIN ||
      p.y > rect.height - FOLLOW_MARGIN
    ) {
      view.tx += rect.width / 2 - p.x
      view.ty += rect.height / 2 - p.y
    }
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
const DRAG_THRESHOLD_PX = 3

function addLabelAt(clientX: number, clientY: number) {
  const file = currentFile.value
  if (!file || file.badge !== 'ok' || !imageReady.value || !containerRef.value) return
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

/** 背景 pointerdown：R 按住 = 旋轉;Space 按住 + 拖 = pan;
 * 短按依工具分流——label 新增標號、move 取消選取 */
let bgDownPos: { x: number; y: number } | null = null
let panLast = { x: 0, y: 0 }
function onBgPointerDown(e: PointerEvent) {
  if (rDown.value) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    rotating.value = true
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
  if (spaceDown.value) {
    panning.value = true
    panLast = { x: e.clientX, y: e.clientY }
  }
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
  const wasPanning = panning.value
  const isClick =
    bgDownPos && Math.hypot(e.clientX - bgDownPos.x, e.clientY - bgDownPos.y) < DRAG_THRESHOLD_PX
  bgDownPos = null
  panning.value = false
  if (!isClick || wasPanning) return
  if (tool.value === 'label') addLabelAt(e.clientX, e.clientY)
  else editor.selectedLabelId = null
}

interface ActiveNativeDrag {
  payload: LabelDragPayload
  filename: string
  source: LabelItem
  startContent: { x: number; y: number }
  oldPos: { x: number; y: number }
  localCommitted: boolean
}

let pendingNativeDrag: {
  labelId: string
  filename: string
  startContent: { x: number; y: number }
} | null = null
let activeNativeDrag: ActiveNativeDrag | null = null
const hiddenNativeMoveId = ref<string | null>(null)

function onNativeLabelPointerDown(label: LabelItem, e: PointerEvent) {
  const file = currentFile.value
  if (!file || e.button !== 0 || !containerRef.value || spaceDown.value) return
  editor.selectedLabelId = label.id
  const rect = containerRef.value.getBoundingClientRect()
  pendingNativeDrag = {
    labelId: label.id,
    filename: file.filename,
    startContent: screenToContentPx(e.clientX, e.clientY, rect, view),
  }
}

function onNativeLabelDragStart(label: LabelItem, e: DragEvent) {
  const file = currentFile.value
  if (!file || !e.dataTransfer || !containerRef.value || spaceDown.value) {
    e.preventDefault()
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const canvasRect = containerRef.value.getBoundingClientRect()
  const operation = e.altKey ? 'copy' : 'move'
  const payload: LabelDragPayload = {
    version: 1,
    kind: 'label',
    source: 'main',
    operation,
    token: crypto.randomUUID(),
    sourceId: label.id,
    label: {
      text: label.text,
      category: label.category,
      groupName: project.header.groups[label.category - 1] ?? '',
    },
    grabOffset: {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    },
  }
  const startContent =
    pendingNativeDrag?.labelId === label.id && pendingNativeDrag.filename === file.filename
      ? pendingNativeDrag.startContent
      : screenToContentPx(e.clientX, e.clientY, canvasRect, view)
  pendingNativeDrag = null
  const source = { ...label }
  activeNativeDrag = {
    payload,
    filename: file.filename,
    source,
    startContent,
    oldPos: { x: label.x, y: label.y },
    localCommitted: false,
  }
  const preview = setLabelDragPreview(e.dataTransfer, label, textPreviewStyle.value, {
    scale: view.scale,
    rotation: view.rotate,
    sourceRect: rect,
    hotspot: payload.grabOffset,
  })
  payload.grabOffset = preview.grabOffset
  e.dataTransfer.clearData()
  e.dataTransfer.setData(LABEL_DRAG_TYPE, serializeLabelDrag(payload))
  e.dataTransfer.effectAllowed = operation
  if (operation === 'move') hiddenNativeMoveId.value = label.id
}

function onNativeLabelDragEnd(e: DragEvent) {
  const active = activeNativeDrag
  activeNativeDrag = null
  pendingNativeDrag = null
  hiddenNativeMoveId.value = null
  if (!active || active.localCommitted) return
  if (active.payload.operation === 'move' && e.dataTransfer?.dropEffect === 'move') {
    editor.cmdDeleteLabel(active.filename, active.payload.sourceId)
  }
}

function onLabelDragOver(e: DragEvent) {
  if (
    !e.dataTransfer ||
    !Array.from(e.dataTransfer.types).includes(LABEL_DRAG_TYPE) ||
    !currentFile.value ||
    currentFile.value.badge !== 'ok' ||
    !imageReady.value
  ) return
  e.preventDefault()
  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
}

function onLabelDrop(e: DragEvent) {
  const file = currentFile.value
  if (!file || file.badge !== 'ok' || !imageReady.value || !containerRef.value || !e.dataTransfer) return
  const payload = parseLabelDrag(e.dataTransfer.getData(LABEL_DRAG_TYPE))
  if (!payload) return
  e.preventDefault()
  e.dataTransfer.dropEffect = payload.operation
  const active = activeNativeDrag
  if (active?.payload.token === payload.token && active.filename === file.filename) {
    const rect = containerRef.value.getBoundingClientRect()
    const content = screenToContentPx(e.clientX, e.clientY, rect, view)
    const x = clamp(
      active.oldPos.x + (content.x - active.startContent.x) / natural.value.w,
      0,
      1,
    )
    const y = clamp(
      active.oldPos.y + (content.y - active.startContent.y) / natural.value.h,
      0,
      1,
    )
    if (payload.operation === 'copy') {
      const duplicate = { ...active.source, id: crypto.randomUUID(), x, y }
      editor.cmdDuplicateLabel(file.filename, duplicate)
      editor.selectedLabelId = duplicate.id
    } else {
      project.moveLabel(file.filename, payload.sourceId, x, y)
      editor.cmdMoveLabel(file.filename, payload.sourceId, active.oldPos, { x, y })
      editor.selectedLabelId = payload.sourceId
    }
    active.localCommitted = true
    return
  }
  const rect = containerRef.value.getBoundingClientRect()
  const content = screenToContentPx(e.clientX, e.clientY, rect, view)
  const x = clamp(content.x / natural.value.w, 0, 1)
  const y = clamp(content.y / natural.value.h, 0, 1)
  if (payload.source === 'main' && payload.operation === 'move') {
    const label = project.fileByName(file.filename)?.labels.find((item) => item.id === payload.sourceId)
    if (label) {
      const oldPos = { x: label.x, y: label.y }
      project.moveLabel(file.filename, label.id, x, y)
      editor.cmdMoveLabel(file.filename, label.id, oldPos, { x, y })
      editor.selectedLabelId = label.id
      return
    }
  }
  editor.cmdDuplicateLabel(file.filename, {
    id: crypto.randomUUID(),
    x,
    y,
    category: resolveDropCategory(payload, project.header.groups, editor.activeCategory),
    text: payload.label.text,
  })
}

function onMarkerPointerDown(label: LabelItem, e: PointerEvent) {
  onNativeLabelPointerDown(label, e)
}

/** 右鍵 marker = 刪除(可 undo,不確認)。滑過即選已隨檢查模式退場——
 * 有文字所見即所得後不再需要 hover 掃描。 */
function onMarkerContextMenu(label: LabelItem, e: MouseEvent) {
  e.preventDefault()
  if (!currentFile.value) return
  editor.cmdDeleteLabel(currentFile.value.filename, label.id)
}

// 畫布快捷鍵（輸入框聚焦時不攔）：0 適應視窗、←/→/Tab 換頁、
// V/T 切工具、Shift+T 輪換分組、Space 按住 pan、
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
  } else if (e.key.toLowerCase() === 'v') {
    tool.value = 'move'
  } else if (e.key.toLowerCase() === 't') {
    if (e.shiftKey) {
      // Shift+T:輪換標號的作用分組(1-9 直選的循環版)
      const n = project.header.groups.length
      if (n > 0) editor.activeCategory = (editor.activeCategory % n) + 1
    } else {
      tool.value = 'label'
    }
  } else if (e.code === 'Space') {
    spaceDown.value = true
    e.preventDefault()
  } else if (e.key.toLowerCase() === 'r') {
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

// keyup 不 guard mode:切走前按住的 R/Space 要能歸零
useEventListener(window, 'keyup', (e) => {
  if (e.key.toLowerCase() === 'r') rDown.value = false
  if (e.code === 'Space') spaceDown.value = false
})

const stageStyle = computed(() => ({
  width: `${natural.value.w}px`,
  height: `${natural.value.h}px`,
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${view.rotate}rad)`,
  transformOrigin: '0 0',
}))
</script>
