<template>
  <div
    v-if="current"
    ref="boxEl"
    class="sample-box"
    :class="editing && 'editing'"
    :style="boxStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @mousedown="holdFocus"
    @dblclick="onDoubleClick"
  >
    <canvas
      ref="canvasEl"
      class="block"
      :width="current.image.width"
      :height="current.image.height"
      :style="boxStyle"
    />
    <div v-for="(box, i) in selectionBoxes" :key="i" class="selection-box" :style="box" />
    <div v-if="caretBox" :key="caretKey" class="caret" :style="caretBox" />
  </div>
  <span
    v-if="failed"
    class="text-destructive/70"
    :style="{ fontSize: `${sizePx * 0.4}px` }"
    :title="failure"
  >
    無法繪製
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { sampleFor, type Sample, type SampleRequest } from '@/lib/fontSampleCache'
import { textProjection } from '@/lib/textProjection'
import type { CaretOnScreen } from '@/lib/pinnedInput'

const props = defineProps<{
  entry: FontEntry
  text: string
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Columns running right to left instead of rows. */
  vertical?: boolean
  /** Signed pixels the strokes move by. */
  weightPx?: number
  /** Outline the characters this family has no glyph for. */
  mark?: boolean
  /**
   * This cell is the one being typed into. The keyboard is in a native control
   * of the picker's; what appears here is a projection of where that control
   * says its caret is.
   */
  editing?: boolean
  /** The control's selection, in UTF-16 offsets, while this is the cell. */
  selection?: { start: number; end: number } | null
  /**
   * Bumped on every caret move, so the blink restarts from the bright half.
   *
   * ⚠️ Only the cell being typed into may be given the moving value. Handing it
   * to every cell makes a caret moving one pixel a re-render of the whole grid.
   */
  caretKey?: number
}>()

const emit = defineEmits<{
  /** Where the pointer put the selection, as offsets into the sample text. */
  selectText: [anchor: number, focus: number]
  /** The word under the pointer, for a double click to take. */
  selectWord: [at: number]
  /** Where the caret stands on screen, or nothing while this is not the cell. */
  caretAt: [at: CaretOnScreen | null]
}>()

/**
 * Literal rather than a theme token: canvas fill styles cannot read CSS custom
 * properties, and the highlight has to stay legible under both themes anyway.
 */
const MARK_COLOR = 'rgba(239, 68, 68, 0.28)'

/** How thick a caret is on screen, in CSS pixels. */
const CARET_PX = 2

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
const boxEl = ref<HTMLElement | null>(null)
/** What belongs on the canvas, which is also the projection's geometry. */
const current = shallowRef<Sample | null>(null)
const failed = ref(false)
const failure = ref('')

// Rasterizing at device resolution keeps glyph shapes judgeable on a HiDPI
// panel, which is the entire point of looking at a sample.
const dpr = window.devicePixelRatio || 1

const request = computed<SampleRequest>(() => ({
  entry: props.entry,
  text: props.text,
  sizePx: Math.round(props.sizePx * dpr),
  fillColor: props.fillColor,
  stroke: props.stroke,
  vertical: props.vertical,
  // Scaled with the size: the sample is drawn at device resolution and shown
  // back down, so an unscaled offset would read thinner than it will typeset.
  weightPx: (props.weightPx ?? 0) * dpr,
}))

const boxStyle = computed(() =>
  current.value
    ? {
        width: `${current.value.image.width / dpr}px`,
        height: `${current.value.image.height / dpr}px`,
      }
    : undefined,
)

const vertical = computed(() => props.vertical === true)

/**
 * The engine's cluster table read as geometry. The one place a caret, a
 * selection and a click are answered from — the same module the canvas asks,
 * so a cell and a page cannot disagree about where the eighth character is.
 */
const projection = computed(() => {
  const sample = current.value
  return textProjection({
    text: props.text,
    clusters: sample?.clusters ?? [],
    vertical: vertical.value,
    padding: sample?.padding ?? 0,
    crossExtent: vertical.value ? (sample?.image.width ?? 0) : (sample?.image.height ?? 0),
  })
})

/** Bitmap pixels to the CSS pixels the sample is shown at. */
function shown(value: number): number {
  return value / dpr
}

const caretBox = computed(() => {
  const at = props.selection
  if (!props.editing || !at) return null
  const r = projection.value.caret(at.end)
  return vertical.value
    ? {
        left: `${shown(r.x)}px`,
        top: `${shown(r.y)}px`,
        width: `${shown(r.width)}px`,
        height: `${CARET_PX}px`,
      }
    : {
        left: `${shown(r.x)}px`,
        top: `${shown(r.y)}px`,
        width: `${CARET_PX}px`,
        height: `${shown(r.height)}px`,
      }
})

/**
 * Boxed line by line rather than as one rectangle: a line shorter than the
 * longest one would otherwise be highlighted past its end, and a vertical run
 * would get a horizontal band across columns it does not fill.
 */
const selectionBoxes = computed(() => {
  const at = props.selection
  if (!props.editing || !at) return []
  return projection.value.selection(at.start, at.end).map((box) => ({
    left: `${shown(box.x)}px`,
    top: `${shown(box.y)}px`,
    width: `${shown(box.width)}px`,
    height: `${shown(box.height)}px`,
  }))
})

/**
 * Which character a client point is nearest to the near side of.
 *
 * The box is upright and unscaled — a cell has no view transform over it — so
 * this is the corner offset taken up to device pixels, which is the space the
 * clusters are in.
 */
function indexAtPointer(e: { clientX: number; clientY: number }): number | null {
  const rect = boxEl.value?.getBoundingClientRect()
  if (!rect) return null
  return projection.value.indexAt((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr)
}

/**
 * ⭐ Measured: refusing the press's default is what keeps the picker's control
 * focused through a click on a cell, so pointing and dragging never take the
 * keyboard away from the text being pointed at.
 */
function holdFocus(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
}

/** Where the selection is being dragged from, or null when no drag is live. */
let anchor: number | null = null

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const at = indexAtPointer(e)
  if (at === null) return
  // The press belongs to the sample, not to the cell around it.
  e.stopPropagation()
  // Capturing keeps the drag alive once the pointer leaves the cell, which is
  // exactly when a selection is being extended past the last character.
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  anchor = e.shiftKey && props.editing ? (props.selection?.start ?? at) : at
  emit('selectText', anchor, at)
}

function onPointerMove(e: PointerEvent) {
  if (anchor === null) return
  const at = indexAtPointer(e)
  if (at !== null) emit('selectText', anchor, at)
}

function onPointerUp(e: PointerEvent) {
  if (anchor === null) return
  anchor = null
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

function onDoubleClick(e: MouseEvent) {
  const at = indexAtPointer(e)
  if (at !== null) emit('selectWord', at)
}

/**
 * Say where the caret stands on screen, so the native control can be put there
 * and the IME's candidate window opens beside the sample.
 *
 * Post-flush, and read off the element: the cell moves whenever the virtual
 * list scrolls or a row is remeasured, and neither of those is something this
 * component is told about in a value it could compute from.
 */
function publishCaret(): void {
  const at = props.selection
  // The cell is asked for its rectangle only once it is the one being typed
  // into. Every other cell in the grid runs this on the same scroll, and a
  // rectangle read is a layout.
  if (!props.editing || !at) return
  const rect = boxEl.value?.getBoundingClientRect()
  if (!rect) return
  const r = projection.value.caret(at.end)
  emit('caretAt', {
    x: rect.left + shown(r.x),
    y: rect.top + shown(r.y),
    width: vertical.value ? shown(r.width) : CARET_PX,
    height: vertical.value ? CARET_PX : shown(r.height),
    angle: 0,
    vertical: vertical.value,
  })
}

watch(
  () => [props.editing, props.selection?.start, props.selection?.end, props.text, current.value],
  publishCaret,
  { flush: 'post' },
)
onMounted(publishCaret)
// Capture, because a scroll does not bubble and the list that moves this cell
// is somebody else's element.
useEventListener(window, 'scroll', publishCaret, { capture: true, passive: true })
useEventListener(window, 'resize', publishCaret)

// A cell recycled out from under the caret would otherwise leave the control
// pinned where its sample no longer is.
onBeforeUnmount(() => {
  if (props.editing) emit('caretAt', null)
})

/**
 * Runs during setup, not on mount. The virtual list measures a row the moment
 * its element exists, and a canvas whose size arrives later gets measured at
 * the wrong height — the list then compensates by moving the scroll position,
 * which is a change of size, which measures again.
 */
function rasterize() {
  try {
    current.value = sampleFor(request.value)
    failed.value = false
  } catch (err) {
    current.value = null
    failure.value = err instanceof Error ? err.message : String(err)
    failed.value = true
    console.error(`font sample failed: ${props.entry.family}`, err)
  }
}
watch(request, rasterize, { immediate: true })

function paint() {
  const el = canvasEl.value
  const sample = current.value
  if (!el || !sample) return
  const ctx = el.getContext('2d')
  if (!ctx) return

  const { image, marks } = sample
  if (props.mark && marks.length > 0) {
    for (const rect of marks) {
      ctx.fillStyle = MARK_COLOR
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
    // putImageData replaces pixels instead of compositing, which would wipe
    // the highlights; going through drawImage keeps them behind the glyphs.
    const glyphs = new OffscreenCanvas(image.width, image.height)
    glyphs.getContext('2d')?.putImageData(image, 0, 0)
    ctx.drawImage(glyphs, 0, 0)
  } else {
    ctx.putImageData(image, 0, 0)
  }
}

// Post-flush: setting the width and height attributes blanks the canvas, so the
// pixels have to go on after Vue has patched them.
onMounted(paint)
watch([current, () => props.mark], paint, { flush: 'post' })
</script>

<style scoped>
/*
 * Sized to the bitmap so the caret and the selection, which anchor to this box,
 * land exactly on the glyphs wherever the cell places the sample. Its own
 * stacking context, so the selection sits under the canvas rather than under
 * the cell.
 */
.sample-box {
  position: relative;
  z-index: 0;
  cursor: text;
}
/* Behind the glyphs, the way a selection in a text field is. */
.selection-box {
  position: absolute;
  z-index: -1;
  background: var(--primary);
  opacity: 0.25;
}
.caret {
  position: absolute;
  background: var(--primary);
  animation: sample-caret-blink 1.1s steps(1) infinite;
}
@keyframes sample-caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
