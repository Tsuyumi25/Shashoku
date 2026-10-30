<template>
  <div
    ref="holder"
    class="sample-holder"
    :class="overflows && 'sample-clipped'"
  >
    <!--
      Scrolled only by a selection dragged past its edge, as a text field is:
      the wheel belongs to the list the cell sits in.
    -->
    <div ref="scroller" class="sample-scroller">
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
      v-else-if="failed"
      class="text-destructive/70"
      :style="{ fontSize: `${sizePx * 0.4}px` }"
      :title="failure"
    >
      無法繪製
    </span>
    <div v-else class="sample-pending" :style="{ width: `${fitWidth}px`, height: `${fitHeight}px` }" />
    </div>
    <!--
      Bars for whichever way the sample runs out, taken by the thumb or a press
      on the track. Never by the wheel: that scrolls the list.
    -->
    <div v-if="overflows && reach.x > 0" class="sample-bar sample-bar-x" @pointerdown="onBarDown('x', $event)">
      <div class="sample-thumb" :style="thumbStyle('x')" />
    </div>
    <div v-if="overflows && reach.y > 0" class="sample-bar sample-bar-y" @pointerdown="onBarDown('y', $event)">
      <div class="sample-thumb" :style="thumbStyle('y')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useElementSize, useElementVisibility, useEventListener } from '@vueuse/core'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { cachedSample, sampleFor, type Sample, type SampleRequest } from '@/lib/fontSampleCache'
import { enqueueSample } from '@/lib/sampleQueue'
import { textProjection } from '@/lib/textProjection'
import { spanOf, type TextSelection } from '@/lib/textSelection'
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
  /**
   * The box the sample is shown inside, in CSS pixels. A sample that comes out
   * larger is shown smaller to fit, so the cell's size never depends on the face.
   */
  fitWidth: number
  fitHeight: number
  /**
   * The size was held up at a floor rather than fitted, so the sample is shown
   * at its size and what will not fit runs out of the box instead of shrinking.
   */
  overflows?: boolean
  /**
   * How far a clipped sample is scrolled from where it starts — the left edge
   * of rows, the right edge of columns — in CSS pixels. Shared by every cell,
   * so dragging a selection along one moves them all to the same place.
   */
  offset?: { x: number; y: number }
  /** Outline the characters this family has no glyph for. */
  mark?: boolean
  /**
   * This cell is the one being typed into. The keyboard is in a native control
   * of the picker's; what appears here is a projection of where that control
   * says its caret is.
   */
  editing?: boolean
  /** The control's selection, in UTF-16 offsets, while this is the cell. */
  selection?: TextSelection | null
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
  /** A selection dragged past the edge asks for the shared offset to move here. */
  scroll: [offset: { x: number; y: number }]
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
  // Device pixels, as the size is.
  stroke: props.stroke && { ...props.stroke, width: props.stroke.width * dpr },
  vertical: props.vertical,
  // Scaled with the size: the sample is drawn at device resolution and shown
  // back down, so an unscaled offset would read thinner than it will typeset.
  weightPx: (props.weightPx ?? 0) * dpr,
}))

/** Shown pixels per bitmap pixel: device resolution, and smaller still if it would not fit. */
const scale = computed(() => {
  const sample = current.value
  if (!sample) return 1 / dpr
  const natural = { w: sample.image.width / dpr, h: sample.image.height / dpr }
  if (props.overflows) return 1 / dpr
  return Math.min(1, props.fitWidth / natural.w, props.fitHeight / natural.h) / dpr
})

const boxStyle = computed(() =>
  current.value
    ? {
        width: `${current.value.image.width * scale.value}px`,
        height: `${current.value.image.height * scale.value}px`,
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
  return value * scale.value
}

const caretBox = computed(() => {
  const at = props.selection
  if (!props.editing || !at) return null
  const r = projection.value.caret(at.focus)
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
  const { from, to } = spanOf(at)
  return projection.value.selection(from, to).map((box) => ({
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
  return projection.value.indexAt((e.clientX - rect.left) / scale.value, (e.clientY - rect.top) / scale.value)
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
  anchor = e.shiftKey && props.editing ? (props.selection?.anchor ?? at) : at
  emit('selectText', anchor, at)
}

function onPointerMove(e: PointerEvent) {
  if (anchor === null) return
  const at = indexAtPointer(e)
  if (at !== null) emit('selectText', anchor, at)
  dragAt = { clientX: e.clientX, clientY: e.clientY }
  edgeFrame ??= requestAnimationFrame(edgeScroll)
}

function onPointerUp(e: PointerEvent) {
  if (anchor === null) return
  anchor = null
  dragAt = null
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
  const r = projection.value.caret(at.focus)
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
  () => [props.editing, props.selection?.anchor, props.selection?.focus, props.text, current.value],
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

/**
 * Queued rather than drawn here: the cell's size is the box it was given, not
 * the bitmap, so nothing waits on this to lay out. A sample already drawn, and
 * the one being typed into, skip the queue.
 */
const holder = useTemplateRef<HTMLElement>('holder')
const scroller = useTemplateRef<HTMLElement>('scroller')

/** The sample as shown, and how far past the box it runs on each axis. */
const content = computed(() => {
  const sample = current.value
  return sample ? { w: sample.image.width * scale.value, h: sample.image.height * scale.value } : { w: 0, h: 0 }
})
/**
 * The window a clipped sample is seen through: all the room the cell gives
 * it, which is wider or taller than the box its size was fitted to whenever
 * the grid's columns come out wider than one box.
 */
const { width: viewW, height: viewH } = useElementSize(scroller)
const reach = computed(() => ({
  x: Math.max(0, content.value.w - viewW.value),
  y: Math.max(0, content.value.h - viewH.value),
}))

/** Asks for an offset, kept inside how far this sample can go. */
function scrollTo(x: number, y: number) {
  emit('scroll', {
    x: Math.max(0, Math.min(reach.value.x, x)),
    y: Math.max(0, Math.min(reach.value.y, y)),
  })
}

/** Where along its track a thumb sits, as a share: columns start at the right. */
function thumbStyle(axis: 'x' | 'y') {
  const view = axis === 'x' ? viewW.value : viewH.value
  const whole = axis === 'x' ? content.value.w : content.value.h
  const size = Math.max(0.08, view / whole)
  const at = reach.value[axis] > 0 ? (props.offset?.[axis] ?? 0) / reach.value[axis] : 0
  const from = (axis === 'x' && props.vertical ? 1 - at : at) * (1 - size)
  return axis === 'x'
    ? { left: `${from * 100}%`, width: `${size * 100}%` }
    : { top: `${from * 100}%`, height: `${size * 100}%` }
}

function scrollAlong(axis: 'x' | 'y', to: number) {
  if (axis === 'x') scrollTo(to, props.offset?.y ?? 0)
  else scrollTo(props.offset?.x ?? 0, to)
}

let barDrag: { axis: 'x' | 'y'; pointerId: number; from: number; offset: number; perPx: number } | null = null

/**
 * A press on the thumb drags it; a press elsewhere on the track jumps there
 * first and then drags, as a native bar does.
 */
function onBarDown(axis: 'x' | 'y', e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const track = e.currentTarget as HTMLElement
  const rect = track.getBoundingClientRect()
  const length = axis === 'x' ? rect.width : rect.height
  const whole = axis === 'x' ? content.value.w : content.value.h
  const sign = axis === 'x' && props.vertical ? -1 : 1
  const perPx = (whole / length) * sign
  const at = axis === 'x' ? e.clientX : e.clientY
  let offset = props.offset?.[axis] ?? 0
  if (!(e.target as HTMLElement).classList.contains('sample-thumb')) {
    const share = (at - (axis === 'x' ? rect.left : rect.top)) / length
    const toward = axis === 'x' && props.vertical ? 1 - share : share
    offset = toward * reach.value[axis]
    scrollAlong(axis, offset)
  }
  track.setPointerCapture(e.pointerId)
  barDrag = { axis, pointerId: e.pointerId, from: at, offset, perPx }
  track.onpointermove = (m) => {
    if (!barDrag || m.pointerId !== barDrag.pointerId) return
    const moved = ((barDrag.axis === 'x' ? m.clientX : m.clientY) - barDrag.from) * barDrag.perPx
    const next = barDrag.offset + moved
    scrollAlong(barDrag.axis, next)
  }
  track.onpointerup = track.onpointercancel = () => {
    barDrag = null
    track.onpointermove = null
  }
}

/** Room kept between a caret brought into view and the box's edge. */
const CARET_MARGIN_PX = 8

/**
 * Keep the caret in view as the keyboard moves it, the way a text field
 * scrolls to follow its caret — the shared offset, so every cell follows.
 */
watch(
  [() => props.selection?.focus, () => props.caretKey],
  () => {
    const at = props.selection
    if (!props.editing || !props.overflows || !at || anchor !== null) return
    const r = projection.value.caret(at.focus)
    const x0 = shown(r.x)
    const x1 = x0 + Math.max(shown(r.width), CARET_PX)
    const y0 = shown(r.y)
    const y1 = y0 + Math.max(shown(r.height), CARET_PX)
    const x = props.offset?.x ?? 0
    const y = props.offset?.y ?? 0
    let left = props.vertical ? reach.value.x - x : x
    let top = y
    if (x0 < left) left = x0 - CARET_MARGIN_PX
    else if (x1 > left + viewW.value) left = x1 - viewW.value + CARET_MARGIN_PX
    if (y0 < top) top = y0 - CARET_MARGIN_PX
    else if (y1 > top + viewH.value) top = y1 - viewH.value + CARET_MARGIN_PX
    const nextX = props.vertical ? reach.value.x - left : left
    if (Math.abs(nextX - x) > 0.5 || Math.abs(top - y) > 0.5) scrollTo(nextX, top)
  },
  { flush: 'post' },
)

function applyOffset() {
  const el = scroller.value
  if (!el) return
  const x = props.offset?.x ?? 0
  el.scrollLeft = props.vertical ? el.scrollWidth - el.clientWidth - x : x
  el.scrollTop = props.offset?.y ?? 0
}
watch([current, () => props.offset, () => props.overflows, () => props.vertical], applyOffset, {
  flush: 'post',
})

/** Where the pointer was last seen while a selection is being dragged. */
let dragAt: { clientX: number; clientY: number } | null = null
let edgeFrame: number | null = null

/** Pixels a frame moves per pixel the pointer is past the edge, and the most it moves. */
const EDGE_GAIN = 0.25
const EDGE_MAX_STEP = 24

function overshoot(at: number, lo: number, hi: number): number {
  const past = at < lo ? at - lo : at > hi ? at - hi : 0
  return Math.max(-EDGE_MAX_STEP, Math.min(EDGE_MAX_STEP, past * EDGE_GAIN))
}

/**
 * While a selection is held past the box's edge, scroll toward the pointer a
 * little every frame and extend the selection over what comes into view — the
 * way a browser's text field does, without the pointer having to keep moving.
 */
function edgeScroll() {
  edgeFrame = null
  const el = scroller.value
  if (anchor === null || !dragAt || !el || !props.overflows) return
  const box = el.getBoundingClientRect()
  const dx = overshoot(dragAt.clientX, box.left, box.right)
  const dy = overshoot(dragAt.clientY, box.top, box.bottom)
  if (dx !== 0 || dy !== 0) {
    const maxX = el.scrollWidth - el.clientWidth
    const maxY = el.scrollHeight - el.clientHeight
    const left = Math.max(0, Math.min(maxX, el.scrollLeft + dx))
    const top = Math.max(0, Math.min(maxY, el.scrollTop + dy))
    el.scrollLeft = left
    el.scrollTop = top
    emit('scroll', { x: props.vertical ? maxX - left : left, y: top })
    const at = indexAtPointer(dragAt)
    if (at !== null) emit('selectText', anchor, at)
  }
  edgeFrame = requestAnimationFrame(edgeScroll)
}
const onScreen = useElementVisibility(holder)
let unqueue: (() => void) | null = null
watch(
  request,
  (req) => {
    unqueue?.()
    unqueue = null
    const held = cachedSample(req)
    if (held || props.editing) {
      if (held) {
        current.value = held
        failed.value = false
      } else rasterize()
      return
    }
    // A bitmap of the old request would be read against the new text: the
    // placeholder holds the box until the right one is drawn.
    current.value = null
    failed.value = false
    unqueue = enqueueSample({ run: rasterize, visible: () => onScreen.value })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  unqueue?.()
  if (edgeFrame !== null) cancelAnimationFrame(edgeFrame)
})

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
.sample-clipped {
  position: relative;
  flex: 1;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
}
.sample-clipped .sample-scroller {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.sample-scroller {
  display: flex;
}
/* Thin and quiet until hovered, like the platform's overlay bars. */
.sample-bar {
  position: absolute;
  z-index: 2;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted-foreground) 12%, transparent);
  cursor: default;
}
.sample-bar-x {
  right: 2px;
  bottom: 1px;
  left: 2px;
  height: 5px;
}
.sample-bar-y {
  top: 2px;
  right: 1px;
  bottom: 2px;
  width: 5px;
}
.sample-bar:hover {
  background: color-mix(in srgb, var(--muted-foreground) 22%, transparent);
}
.sample-thumb {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
}
.sample-bar-x .sample-thumb {
  right: auto;
}
.sample-bar-y .sample-thumb {
  bottom: auto;
}
.sample-box {
  position: relative;
  z-index: 0;
  cursor: text;
}
/* The box a sample waits in, so the cell already has the size it will keep. */
.sample-pending {
  border-radius: 0.25rem;
  background: color-mix(in oklch, var(--muted-foreground) 8%, transparent);
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
