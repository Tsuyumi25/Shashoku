<template>
  <div
    ref="containerRef"
    class="relative h-full min-h-0 w-full touch-none overflow-hidden bg-muted select-none"
    :class="[canvasCursor]"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @contextmenu.prevent
  >
    <template v-if="currentFile && src">
      <img ref="imgRef" :src="src" class="hidden" alt="" @load="onImageLoad" />
      <canvas ref="baseCanvasRef" class="pointer-events-none absolute inset-0 h-full w-full" />

      <!--
        Outside the transformed stage on purpose: these carry their own pixels
        and place themselves in screen coordinates. The layer itself is
        transparent to the pointer so a drag on bare page still reaches the
        canvas gestures, and the frames go over the text because they are what
        the pointer is meant to find.
      -->
      <div v-if="imageReady" class="pointer-events-none absolute inset-0">
        <LabelText
          v-for="object in objects"
          :key="object.id"
          :text="object.text"
          :text-style="object.style"
          :x="object.x"
          :y="object.y"
          :rotation="object.rotation"
          :natural="editor.viewContentSize"
          :view="view"
        />
        <LabelBox
          v-for="object in objects"
          :key="object.id"
          :class="[!gestureArmed && 'pointer-events-auto']"
          :index="object.index"
          :text="object.text"
          :text-style="object.style"
          :x="object.x"
          :y="object.y"
          :rotation="object.rotation"
          :color="object.color"
          :natural="editor.viewContentSize"
          :view="view"
          :selected="object.id === editor.cursorId"
          :in-selection="editor.isSelected(object.id)"
          @select="editor.selectOnly(object.id)"
          @move="moveLabelTo(object.id, $event)"
          @move-end="(from, to) => commitLabelMove(object.id, from, to)"
          @scale-start="beginLabelScale(object.id)"
          @scale="scaleLabelTo(object.id, $event)"
          @scale-end="commitLabelScale(object.id)"
          @rotate="rotateLabelTo(object.id, $event)"
          @rotate-end="(from, to) => commitLabelRotate(object.id, from, to)"
        />
      </div>
    </template>

    <div v-else class="flex h-full items-center justify-center select-none">
      <span v-if="currentFile" class="text-xs text-muted-foreground">
        {{ currentFile.badge === 'ok' ? '載入中…' : `圖檔不存在：${currentFile.filename}` }}
      </span>
      <span v-else class="text-sm text-muted-foreground">開啟一個資料夾開始工作</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import LabelBox from '@/components/LabelBox.vue'
import LabelText from '@/components/LabelText.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import type { TextLayerEntry } from '@shared/page/types'
import { visibleTextObjects } from '@shared/page/tree'
import { textOf } from '@shared/page/text'
import type { Anchor } from '@/composables/useLabelDrag'
import { screenToPageFraction } from '@/lib/coords'
import { loadFontCatalog } from '@/lib/fontCatalog'
import {
  beginRotationDirection,
  resetRotationDirection,
  trackRotationDirection,
} from '@/lib/rotateDirection'
import { resolveTextStyle } from '@/lib/textStyle'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()
const preferences = usePreferencesStore()
const fontPicker = useFontPicker()

const view = editor.view

const currentFile = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename) ?? null) : null,
)

/**
 * Every label on the page, empty ones included: an object with no text still
 * has a frame, and the frame is what makes it findable.
 *
 * Laid out in stacking order, which is the tree's, while the number on each
 * frame comes from the reading order — the two are separate sequences now, and
 * the canvas is where both are visible at once.
 *
 * Resolved here rather than in the template so that panning, which re-renders
 * this component on every frame, does not hand each label a new style object
 * and make it look like the text changed.
 */
const objects = computed(() => {
  const file = currentFile.value
  if (!file) return []
  const numbering = new Map(file.page.readingOrder.map((id, i) => [id, i + 1]))
  return visibleTextObjects(file.page).map((label) => ({
    id: label.id,
    index: numbering.get(label.id) ?? 0,
    text: textOf(label),
    x: label.x,
    y: label.y,
    rotation: label.rotation,
    color: colorOf(label.groupId),
    style: resolveTextStyle(label, project.header.groups, project.header.defaultStyle),
  }))
})

// The picker enumerates on its first opening, which is too late for text that
// is on screen before anyone asks to change a font.
onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('font enumeration failed', err)
  })
})

/**
 * A drag writes straight through so the page keeps up with the pointer, and
 * only the release enters the undo stack — otherwise one drag would leave a
 * frame's worth of entries to undo one at a time.
 */
function moveLabelTo(labelId: string, to: Anchor) {
  if (!editor.currentFilename) return
  project.moveLabel(editor.currentFilename, labelId, to.x, to.y)
}

function commitLabelMove(labelId: string, from: Anchor, to: Anchor) {
  if (!editor.currentFilename) return
  editor.cmdMoveLabel(editor.currentFilename, labelId, from, to)
}

function labelById(labelId: string): TextLayerEntry | undefined {
  return editor.currentFilename
    ? project.labelById(editor.currentFilename, labelId)
    : undefined
}

/**
 * A corner drag writes an override on top of whatever the label already had,
 * so the before has to be taken once at the start rather than reconstructed
 * from the size afterwards: a label that was inheriting its size has no
 * `fontSizePx` to put back, and undo has to remove the key, not restore a value.
 */
let scaledFrom: TextLayerEntry['styleOverride']

function beginLabelScale(labelId: string) {
  scaledFrom = labelById(labelId)?.styleOverride
}

function scaleLabelTo(labelId: string, fontSizePx: number) {
  const label = labelById(labelId)
  if (!label || !editor.currentFilename) return
  project.updateLabelStyleOverride(editor.currentFilename, labelId, {
    ...(label.styleOverride ?? {}),
    fontSizePx,
  })
}

function commitLabelScale(labelId: string) {
  if (!editor.currentFilename) return
  editor.cmdUpdateLabelStyleOverride(
    editor.currentFilename,
    labelId,
    scaledFrom,
    labelById(labelId)?.styleOverride,
  )
}

function rotateLabelTo(labelId: string, radians: number) {
  if (!editor.currentFilename) return
  project.rotateLabel(editor.currentFilename, labelId, radians)
}

function commitLabelRotate(labelId: string, from: number, to: number) {
  if (!editor.currentFilename) return
  editor.cmdRotateLabel(editor.currentFilename, labelId, from, to)
}

function colorOf(groupId: string | null): string {
  if (!groupId) return 'rgb(128, 128, 128)'
  const g = project.header.groups.find((gg) => gg.id === groupId)
  return g?.color ?? 'rgb(128, 128, 128)'
}

const containerRef = useTemplateRef('containerRef')
const imgRef = useTemplateRef('imgRef')
const baseCanvasRef = useTemplateRef('baseCanvasRef')
const imageReady = ref(false)

useResizeObserver(containerRef, (entries) => {
  const { width, height } = entries[0].contentRect
  // A hidden mode measures 0x0; keeping the last real size means coming back
  // to this view finds the transform it was left with.
  if (!width || !height) return
  editor.viewContainerSize = { w: width, h: height }
  fitUnfittedPage()
  scheduleBaseDraw()
})

/**
 * The page is drawn into a viewport-sized canvas instead of being a CSS-scaled
 * `<img>`, which is why the `<img>` is hidden and only decodes. Scaling an
 * `<img>` down goes through Chromium's mipmap path and loses detail — measured
 * at roughly half the high-frequency energy of a single bilinear step — while
 * `imageSmoothingQuality: 'high'` keeps 86% of it and still suppresses the
 * aliasing a raw bilinear step leaves on screentones and hairlines.
 */
function drawBase() {
  const cv = baseCanvasRef.value
  if (!cv) return
  const g = cv.getContext('2d')
  if (!g) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(editor.viewContainerSize.w * dpr))
  const h = Math.max(1, Math.round(editor.viewContainerSize.h * dpr))
  // Remounting skips a resize callback, so the backing store is sized here.
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
  // Past 3x the point is to see the pixel grid, as in every other raster editor.
  g.imageSmoothingEnabled = view.scale < 3
  g.imageSmoothingQuality = view.scale < 1 ? 'high' : 'low'
  g.drawImage(img, 0, 0)
}

let baseDrawScheduled = false
function scheduleBaseDraw() {
  if (baseDrawScheduled) return
  baseDrawScheduled = true
  requestAnimationFrame(() => {
    baseDrawScheduled = false
    drawBase()
  })
}

watch(view, scheduleBaseDraw)
watch(imageReady, scheduleBaseDraw)

const src = ref<string | null>(null)
let currentUrl: string | null = null

function revoke() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}

watch(
  () => [project.rawsDir, editor.currentFilename, currentFile.value?.badge] as const,
  async ([rawsDir, filename, badge]) => {
    revoke()
    src.value = null
    imageReady.value = false
    scheduleBaseDraw()
    if (!rawsDir || !filename || badge !== 'ok') return
    try {
      const bytes = await window.api.readImage(rawsDir, filename)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      currentUrl = url
      src.value = url
    } catch (err) {
      console.error(err)
    }
  },
  { immediate: true },
)

onBeforeUnmount(revoke)

/**
 * Fitting is per page, not per decode: turning the page starts you fitted, but
 * a page you have already framed keeps its zoom when it is redrawn.
 */
function fitUnfittedPage() {
  if (!imageReady.value || editor.viewFittedPage === editor.currentFilename) return
  if (editor.fitToView()) editor.viewFittedPage = editor.currentFilename
}

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  editor.viewContentSize = { w: img.naturalWidth, h: img.naturalHeight }
  imageReady.value = true
  fitUnfittedPage()
}

const spaceDown = ref(false)
const rDown = ref(false)
const rotating = ref(false)
const panning = ref(false)
let rotatePivot = { x: 0, y: 0 }
let rotateStartAngle = 0
let rotateStartTheta = 0
let panLast = { x: 0, y: 0 }
let lastEscapeAt = 0

/** Which way the drag is currently turning, which is the cursor the R gesture shows. */
const rotateDirection = reactive(beginRotationDirection(1, 0))

// While a gesture is armed the markers let the pointer through, so a drag that
// starts on one still pans or rotates the page under it.
const gestureArmed = computed(() => spaceDown.value || rDown.value)

const canvasCursor = computed(() => {
  if (panning.value) return 'cursor-grabbing'
  if (rotating.value || rDown.value) {
    return rotateDirection.sign === 1 ? 'cursor-rotate-cw' : 'cursor-rotate-ccw'
  }
  if (spaceDown.value) return 'cursor-grab'
  if (editor.tool === 'text') return 'cursor-crosshair'
  return 'cursor-default'
})

function onWheel(e: WheelEvent) {
  if (!imageReady.value) return
  editor.wheelZoom(e)
}

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (!imageReady.value || !containerRef.value) return
  if (rDown.value) {
    el.setPointerCapture(e.pointerId)
    rotating.value = true
    const rect = containerRef.value.getBoundingClientRect()
    rotatePivot = { x: rect.width / 2, y: rect.height / 2 }
    rotateStartAngle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    rotateStartTheta = view.rotate
    resetRotationDirection(rotateDirection, rotateStartAngle)
    return
  }
  if (e.button !== 0) return
  if (spaceDown.value) {
    el.setPointerCapture(e.pointerId)
    panning.value = true
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  // Reaching here means bare page: the markers and the text stop the event on
  // their way out, so anything left started on the page itself.
  if (editor.tool === 'text') {
    const rect = containerRef.value.getBoundingClientRect()
    const p = screenToPageFraction(e.clientX, e.clientY, rect, view, editor.viewContentSize)
    editor.addLabelAt(p.x, p.y)
    return
  }
  editor.selectOnly(null)
}

const ROTATE_SNAP = Math.PI / 12

function onPointerMove(e: PointerEvent) {
  if (rotating.value && containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const angle = Math.atan2(
      e.clientY - rect.top - rotatePivot.y,
      e.clientX - rect.left - rotatePivot.x,
    )
    trackRotationDirection(rotateDirection, angle)
    let theta = rotateStartTheta + (angle - rotateStartAngle)
    if (e.shiftKey) theta = Math.round(theta / ROTATE_SNAP) * ROTATE_SNAP
    editor.rotateTo(theta, rotatePivot.x, rotatePivot.y)
    return
  }
  if (!panning.value) return
  editor.panBy(e.clientX - panLast.x, e.clientY - panLast.y)
  panLast = { x: e.clientX, y: e.clientY }
}

function onPointerUp(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  rotating.value = false
  panning.value = false
}

const ESCAPE_DOUBLE_MS = 400

useEventListener(window, 'keydown', (e) => {
  if (ui.view !== 'translate' || fontPicker.isOpen.value) return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (el instanceof HTMLSelectElement) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  if (e.key === '0') {
    if (imageReady.value) editor.fitToView()
  } else if (e.key === 'ArrowLeft') {
    editor.pageBy(-1)
  } else if (e.key === 'ArrowRight') {
    editor.pageBy(1)
  } else if (e.code === 'Space') {
    spaceDown.value = true
    e.preventDefault()
  } else if (e.key.toLowerCase() === 'r') {
    rDown.value = true
  } else if (e.key.toLowerCase() === 't') {
    editor.setTool('text')
  } else if (e.key.toLowerCase() === 'v') {
    editor.setTool('select')
  } else if (e.key === 'Escape') {
    const now = performance.now()
    const isDouble = now - lastEscapeAt < ESCAPE_DOUBLE_MS
    lastEscapeAt = isDouble ? 0 : now
    if (isDouble) {
      if (imageReady.value) editor.fitToView()
    } else if (rDown.value && containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      editor.rotateTo(0, rect.width / 2, rect.height / 2)
    }
  }
})

// Deliberately unguarded: a key held down while the mode changed still has to
// be able to release, or the canvas is stuck in pan or rotate.
useEventListener(window, 'keyup', (e) => {
  if (e.key.toLowerCase() === 'r') rDown.value = false
  if (e.code === 'Space') spaceDown.value = false
})
</script>

<style scoped>
/*
 * CSS has no rotate keyword, so these are lucide's redo and undo arcs. An arc
 * is used rather than a full circle because a ring reads the same whichever
 * way it turns, while the arc's silhouette states a direction on sight. Each
 * is stroked twice, a white halo under black, so it survives both a white page
 * and the dark gutter around it.
 */
.cursor-rotate-cw {
  cursor:
    url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3e%3cg stroke='white' stroke-width='5'%3e%3cpath d='M21 7v6h-6'/%3e%3cpath d='M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'/%3e%3c/g%3e%3cg stroke='black' stroke-width='2'%3e%3cpath d='M21 7v6h-6'/%3e%3cpath d='M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'/%3e%3c/g%3e%3c/svg%3e")
      14 14,
    grab;
}
.cursor-rotate-ccw {
  cursor:
    url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3e%3cg stroke='white' stroke-width='5'%3e%3cpath d='M3 7v6h6'/%3e%3cpath d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/%3e%3c/g%3e%3cg stroke='black' stroke-width='2'%3e%3cpath d='M3 7v6h6'/%3e%3cpath d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/%3e%3c/g%3e%3c/svg%3e")
      14 14,
    grab;
}
</style>
