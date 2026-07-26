<template>
  <div
    ref="hostEl"
    tabindex="0"
    class="editor-host"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    autocomplete="off"
    :style="hostStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @dblclick="onDoubleClick"
    @keydown="onKeyDown"
    @beforeinput="onBeforeInput"
    @focus="focused = true"
    @blur="onBlur"
  >
    <div v-for="(box, i) in selectionBoxes" :key="i" class="selection-box" :style="box" />
    <div v-if="focused" :key="caretTick" class="caret" :style="caretStyle" />
    <div v-for="(bar, i) in underlines" :key="i" class="composition-bar" :style="bar" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { EngineClusterRect } from '@shared/engine/types'
import { canEditInCell } from '@/lib/editContext'
import type { Sample } from '@/lib/fontSampleCache'

const props = withDefaults(
  defineProps<{
    /** The bitmap being edited on top of. Its clusters carry all the geometry. */
    sample: Sample
    /** Text the sample was drawn from, so clusters and offsets agree. */
    text: string
    vertical?: boolean
    /**
     * Client point of the click that opened the editor. The caret lands there
     * rather than at the end, so one click reads as putting a cursor in a field
     * instead of as opening something.
     */
    startAt?: { clientX: number; clientY: number } | null
  }>(),
  { vertical: false, startAt: null },
)

const emit = defineEmits<{ 'update:text': [string]; close: [] }>()

const CARET_THICKNESS = 2
/** Width given to a blank line so a selection running through it stays visible. */
const BLANK_LINE_SLIVER_PX = 4

const hostEl = ref<HTMLElement | null>(null)
const dpr = window.devicePixelRatio || 1

const selStart = ref(props.text.length)
const selEnd = ref(props.text.length)
const composing = ref(false)
const focused = ref(false)
const formats = shallowRef<TextFormat[]>([])
// Bumped on every caret move so Vue rebuilds the element: a CSS animation runs
// on a document-wide clock, and a caret that lands mid-blink reads as a click
// that did not register.
const caretTick = ref(0)

let context: EditContext | null = null
let boundsRange: [number, number] | null = null
/**
 * The string as the EditContext believes it to be. Props arrive a tick later,
 * so two updates inside one turn would otherwise both build on a stale base.
 */
let latest = props.text

const padding = computed(() => props.sample.padding)

const hostStyle = computed(() => ({
  width: `${props.sample.image.width / dpr}px`,
  height: `${props.sample.image.height / dpr}px`,
}))

// ── UTF-16 (EditContext) ↔ UTF-8 (engine clusters) ─────────────────────────
// The whole geometry layer straddles this seam: every offset EditContext hands
// over indexes JS string units, every cluster the engine reports is a byte
// offset into the same string encoded as UTF-8.

const byteOf = computed(() => {
  const source = props.text
  const out = new Array<number>(source.length + 1)
  let bytes = 0
  let i = 0
  while (i < source.length) {
    const cp = source.codePointAt(i) as number
    const units = cp > 0xffff ? 2 : 1
    out[i] = bytes
    if (units === 2) out[i + 1] = bytes
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    i += units
  }
  out[source.length] = bytes
  return out
})

function byteAt(index: number): number {
  const table = byteOf.value
  return table[Math.max(0, Math.min(index, table.length - 1))] ?? 0
}

function indexOfByte(byte: number): number {
  const table = byteOf.value
  for (let i = 0; i < table.length; i += 1) {
    if (table[i] === byte) return i
    if (table[i] > byte) return Math.max(0, i - 1)
  }
  return table.length - 1
}

// ── Line geometry ──────────────────────────────────────────────────────────
// One "line" is a row when horizontal and a column when vertical; the engine
// lays both out from \n-separated segments, so the same index works for each.

const lineStarts = computed(() => {
  const out = [0]
  for (let i = 0; i < props.text.length; i += 1) {
    if (props.text[i] === '\n') out.push(i + 1)
  }
  return out
})

function lineOfIndex(index: number): number {
  const starts = lineStarts.value
  let line = 0
  while (line + 1 < starts.length && starts[line + 1] <= index) line += 1
  return line
}

function lineRange(line: number): [number, number] {
  const starts = lineStarts.value
  const start = starts[line] ?? 0
  const next = starts[line + 1]
  return [start, next === undefined ? props.text.length : next - 1]
}

/**
 * Line boxes read off the glyphs rather than by dividing the bitmap between
 * them. The engine rounds the bitmap up to whole pixels and anchors the run to
 * one edge, so dividing that width back out drifts a fraction of a pixel
 * further with every line. Clusters carry the exact box, and which line each
 * one belongs to is settled by its byte offset rather than by its coordinates.
 */
const lineMetrics = computed(() => {
  const starts = lineStarts.value
  const table = byteOf.value
  const byLine: EngineClusterRect[][] = starts.map(() => [])
  const boundaries = starts.map((index) => table[index] ?? 0)

  for (const rect of props.sample.clusters) {
    let line = 0
    while (line + 1 < boundaries.length && boundaries[line + 1] <= rect.cluster) line += 1
    byLine[line].push(rect)
  }

  // Every line box is the same size, so one line with glyphs in it fixes the
  // whole grid — including the empty lines, which have nothing to measure.
  for (let line = 0; line < byLine.length; line += 1) {
    const rect = byLine[line][0]
    if (!rect) continue
    return {
      byLine,
      anchorLine: line,
      anchorOffset: props.vertical ? rect.x : rect.y,
      size: props.vertical ? rect.width : rect.height,
    }
  }

  const image = props.sample.image
  const total = props.vertical ? image.width : image.height
  const size = (total - padding.value * 2) / starts.length
  return {
    byLine,
    anchorLine: 0,
    anchorOffset: props.vertical ? image.width - padding.value - size : padding.value,
    size,
  }
})

/** Extent of one line across the writing direction, in bitmap pixels. */
const lineSize = computed(() => lineMetrics.value.size)

/** Where line `n`'s box starts on the cross axis, in bitmap pixels. */
function lineOffset(line: number): number {
  const { anchorLine, anchorOffset, size } = lineMetrics.value
  const step = line - anchorLine
  // Vertical text runs right to left, so a later column sits further left.
  return props.vertical ? anchorOffset - size * step : anchorOffset + size * step
}

/** Which line a point on the cross axis falls in, unclamped. */
function lineAtOffset(at: number): number {
  const { anchorLine, anchorOffset, size } = lineMetrics.value
  if (size <= 0) return anchorLine
  return props.vertical
    ? anchorLine + Math.ceil((anchorOffset + size - at) / size) - 1
    : anchorLine + Math.floor((at - anchorOffset) / size)
}

function rectsOnLine(line: number) {
  return lineMetrics.value.byLine[line] ?? []
}

/** Position along the writing direction, in bitmap pixels. */
function caretMain(index: number): number {
  const byte = byteAt(index)
  const rects = rectsOnLine(lineOfIndex(index))
  const exact = rects.find((r) => r.cluster === byte)
  if (exact) return props.vertical ? exact.y : exact.x

  let before: (typeof rects)[number] | undefined
  for (const r of rects) {
    if (r.cluster < byte && (!before || r.cluster > before.cluster)) before = r
  }
  if (before) return props.vertical ? before.y + before.height : before.x + before.width
  return padding.value
}

const caretStyle = computed(() => {
  const index = selEnd.value
  const main = caretMain(index) / dpr
  const cross = lineOffset(lineOfIndex(index)) / dpr
  const across = lineSize.value / dpr
  return props.vertical
    ? { left: `${cross}px`, top: `${main}px`, width: `${across}px`, height: `${CARET_THICKNESS}px` }
    : { left: `${main}px`, top: `${cross}px`, width: `${CARET_THICKNESS}px`, height: `${across}px` }
})

const selectionBoxes = computed(() => {
  const from = Math.min(selStart.value, selEnd.value)
  const to = Math.max(selStart.value, selEnd.value)
  if (from === to) return []

  const boxes: Record<string, string>[] = []
  const across = lineSize.value / dpr
  for (let line = lineOfIndex(from); line <= lineOfIndex(to); line += 1) {
    const [lineFrom, lineTo] = lineRange(line)
    const head = caretMain(Math.max(from, lineFrom)) / dpr
    const tail = caretMain(Math.min(to, lineTo)) / dpr
    const cross = lineOffset(line) / dpr
    // A selection that swallows a blank line has nothing there to draw, so it
    // gets a sliver to keep the run continuous. A line the selection merely
    // touches at its edge gets nothing: the end of one line and the start of
    // the next are the same point, and drawing it marks a line that holds none
    // of the selection.
    const blank = lineFrom === lineTo
    if (tail <= head && !blank) continue
    const span = Math.max(tail - head, BLANK_LINE_SLIVER_PX)
    boxes.push(
      props.vertical
        ? { left: `${cross}px`, top: `${head}px`, width: `${across}px`, height: `${span}px` }
        : { left: `${head}px`, top: `${cross}px`, width: `${span}px`, height: `${across}px` },
    )
  }
  return boxes
})

const underlines = computed(() => {
  if (!composing.value) return []
  const bars: Record<string, string>[] = []
  for (const format of formats.value) {
    const thick = format.underlineThickness.toLowerCase().includes('thick') ? 3 : 1
    for (let i = format.rangeStart; i < format.rangeEnd; i += 1) {
      const byte = byteAt(i)
      const rect = props.sample.clusters.find((r) => r.cluster === byte)
      if (!rect) continue
      bars.push(
        props.vertical
          ? {
              left: `${(rect.x + rect.width) / dpr - thick}px`,
              top: `${rect.y / dpr}px`,
              width: `${thick}px`,
              height: `${rect.height / dpr}px`,
            }
          : {
              left: `${rect.x / dpr}px`,
              top: `${(rect.y + rect.height) / dpr - thick}px`,
              width: `${rect.width / dpr}px`,
              height: `${thick}px`,
            },
      )
    }
  }
  return bars
})

// ── Reporting position to the IME ──────────────────────────────────────────

function syncBounds() {
  const host = hostEl.value
  if (!context || !host) return
  const box = host.getBoundingClientRect()
  context.updateControlBounds(box)

  const style = caretStyle.value as Record<string, string>
  context.updateSelectionBounds(
    new DOMRect(
      box.left + Number.parseFloat(style.left ?? '0'),
      box.top + Number.parseFloat(style.top ?? '0'),
      Number.parseFloat(style.width ?? '1'),
      Number.parseFloat(style.height ?? '1'),
    ),
  )
}

function clientRectOf(index: number): DOMRect {
  const box = hostEl.value?.getBoundingClientRect()
  if (!box) return new DOMRect(0, 0, 0, 0)
  const rect = props.sample.clusters.find((r) => r.cluster === byteAt(index))
  if (!rect) {
    const main = caretMain(index) / dpr
    const cross = lineOffset(lineOfIndex(index)) / dpr
    return props.vertical
      ? new DOMRect(box.left + cross, box.top + main, lineSize.value / dpr, 1)
      : new DOMRect(box.left + main, box.top + cross, 1, lineSize.value / dpr)
  }
  return new DOMRect(
    box.left + rect.x / dpr,
    box.top + rect.y / dpr,
    rect.width / dpr,
    rect.height / dpr,
  )
}

/**
 * Resent after every redraw, not only when asked: the request arrives before
 * the bitmap for the new text exists, so answering once would place the
 * candidate window against the previous layout.
 */
function sendCharacterBounds() {
  if (!context || !boundsRange) return
  const [start, end] = boundsRange
  const bounds: DOMRect[] = []
  for (let i = start; i < end; i += 1) bounds.push(clientRectOf(i))
  context.updateCharacterBounds(start, bounds)
}

// ── Selection ──────────────────────────────────────────────────────────────

function setSelection(start: number, end = start) {
  selStart.value = start
  selEnd.value = end
  caretTick.value += 1
  context?.updateSelection(start, end)
  syncBounds()
}

const selectedText = computed(() =>
  props.text.slice(Math.min(selStart.value, selEnd.value), Math.max(selStart.value, selEnd.value)),
)

/**
 * The EditContext does not own clipboard or Enter changes — no textupdate
 * follows — so it has to be told separately from the string we publish.
 */
function replaceSelection(insert: string) {
  const from = Math.min(selStart.value, selEnd.value)
  const to = Math.max(selStart.value, selEnd.value)
  context?.updateText(from, to, insert)
  latest = latest.slice(0, from) + insert + latest.slice(to)
  emit('update:text', latest)
  setSelection(from + insert.length)
}

function onCopy(e: ClipboardEvent) {
  if (!selectedText.value) return
  e.clipboardData?.setData('text/plain', selectedText.value)
  e.preventDefault()
}

function onCut(e: ClipboardEvent) {
  if (!selectedText.value) return
  e.clipboardData?.setData('text/plain', selectedText.value)
  e.preventDefault()
  replaceSelection('')
}

function onPaste(e: ClipboardEvent) {
  const incoming = e.clipboardData?.getData('text/plain') ?? ''
  e.preventDefault()
  if (incoming) replaceSelection(incoming)
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })

function stepGrapheme(index: number, delta: number): number {
  const stops = [0]
  for (const piece of graphemes.segment(props.text)) {
    stops.push(piece.index + piece.segment.length)
  }
  const at = stops.findIndex((stop) => stop >= index)
  const current = at < 0 ? stops.length - 1 : at
  return stops[Math.max(0, Math.min(current + delta, stops.length - 1))] ?? index
}

/** Nearest index on `line` to the caret's current position along the run. */
function indexOnLine(line: number, main: number): number {
  const [start, end] = lineRange(line)
  const rects = rectsOnLine(line)
  if (!rects.length) return start
  let best = rects[0]
  let bestGap = Infinity
  for (const r of rects) {
    const near = props.vertical ? r.y : r.x
    const gap = Math.abs(near + (props.vertical ? r.height : r.width) / 2 - main)
    if (gap < bestGap) {
      bestGap = gap
      best = r
    }
  }
  const near = props.vertical ? best.y : best.x
  const size = props.vertical ? best.height : best.width
  const index = indexOfByte(best.cluster)
  return main > near + size / 2 ? Math.min(index + 1, end) : Math.max(index, start)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (composing.value) return
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }

  const forward = props.vertical ? 'ArrowDown' : 'ArrowRight'
  const backward = props.vertical ? 'ArrowUp' : 'ArrowLeft'
  const nextLine = props.vertical ? 'ArrowLeft' : 'ArrowDown'
  const prevLine = props.vertical ? 'ArrowRight' : 'ArrowUp'

  // Shift drags the focus end and leaves the anchor; a plain arrow with a live
  // selection collapses onto the edge it moved towards rather than stepping.
  const moveTo = (index: number) => {
    if (e.shiftKey) setSelection(selStart.value, index)
    else setSelection(index)
  }
  const collapsed = selStart.value === selEnd.value

  if (e.key === forward || e.key === backward) {
    e.preventDefault()
    const ahead = e.key === forward
    if (!collapsed && !e.shiftKey) {
      setSelection(
        ahead ? Math.max(selStart.value, selEnd.value) : Math.min(selStart.value, selEnd.value),
      )
      return
    }
    moveTo(stepGrapheme(selEnd.value, ahead ? 1 : -1))
    return
  }
  if (e.key === nextLine || e.key === prevLine) {
    e.preventDefault()
    const line = lineOfIndex(selEnd.value) + (e.key === nextLine ? 1 : -1)
    if (line < 0 || line >= lineStarts.value.length) return
    moveTo(indexOnLine(line, caretMain(selEnd.value)))
    return
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    const [start, end] = lineRange(lineOfIndex(selEnd.value))
    moveTo(e.key === 'Home' ? start : end)
    return
  }
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    setSelection(0, props.text.length)
  }
  // Everything else — typing, Backspace, Delete, composition — is left to the
  // EditContext, which reports the result through textupdate.
}

/** Enter is the one editing intent the EditContext leaves to the author. */
function onBeforeInput(e: InputEvent) {
  if (e.inputType !== 'insertParagraph' && e.inputType !== 'insertLineBreak') return
  e.preventDefault()
  replaceSelection('\n')
}

/** Nearest caret position to a client point, as a UTF-16 index. */
function indexAtPointer(e: { clientX: number; clientY: number }): number | null {
  const box = hostEl.value?.getBoundingClientRect()
  if (!box) return null

  const x = (e.clientX - box.left) * dpr
  const y = (e.clientY - box.top) * dpr

  const line = Math.max(
    0,
    Math.min(lineAtOffset(props.vertical ? x : y), lineStarts.value.length - 1),
  )
  const main = props.vertical ? y : x

  const [start, end] = lineRange(line)
  const rects = rectsOnLine(line)
  if (!rects.length) return start

  const hit = rects.find((r) => {
    const near = props.vertical ? r.y : r.x
    const span = props.vertical ? r.height : r.width
    return main >= near && main < near + span
  })
  if (!hit) {
    const first = rects[0]
    return main < (props.vertical ? first.y : first.x) ? start : end
  }

  const near = props.vertical ? hit.y : hit.x
  const span = props.vertical ? hit.height : hit.width
  const index = indexOfByte(hit.cluster)
  return main < near + span / 2 ? index : Math.min(index + 1, end)
}

let anchor: number | null = null

function onPointerDown(e: PointerEvent) {
  hostEl.value?.focus({ preventScroll: true })
  const at = indexAtPointer(e)
  if (at === null) return
  e.stopPropagation()
  // Capturing keeps the drag alive once the pointer leaves the canvas, which is
  // exactly when a selection is being extended past the last character.
  hostEl.value?.setPointerCapture(e.pointerId)
  anchor = e.shiftKey ? selStart.value : at
  setSelection(anchor, at)
}

function onPointerMove(e: PointerEvent) {
  if (anchor === null) return
  const at = indexAtPointer(e)
  if (at !== null) setSelection(anchor, at)
}

function onPointerUp(e: PointerEvent) {
  if (anchor === null) return
  anchor = null
  hostEl.value?.releasePointerCapture(e.pointerId)
}

function onDoubleClick(e: MouseEvent) {
  e.stopPropagation()
  const at = indexAtPointer(e)
  if (at === null) return
  for (const piece of words.segment(props.text)) {
    const end = piece.index + piece.segment.length
    if (at >= piece.index && at < end) {
      setSelection(piece.index, end)
      return
    }
  }
}

/** Long enough to cover the press that opened the editor, short enough that a
 * real click elsewhere still ends editing. */
const SETTLE_MS = 150
let openedAt = 0

function onBlur() {
  focused.value = false
  // Leaving mid-composition would strand the IME with no target to commit into.
  if (composing.value) return
  // The press that opens the editor can clear focus a beat after the editor has
  // taken it, since the cell underneath cannot hold focus itself. That is the
  // opening click finishing, not the user leaving, so take focus back.
  if (performance.now() - openedAt < SETTLE_MS) {
    hostEl.value?.focus({ preventScroll: true })
    return
  }
  emit('close')
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
  const host = hostEl.value
  if (!canEditInCell || !host) return

  const ec = new EditContext({
    text: props.text,
    selectionStart: selStart.value,
    selectionEnd: selEnd.value,
  })
  context = ec
  host.editContext = ec

  ec.addEventListener('textupdate', (e) => {
    latest = latest.slice(0, e.updateRangeStart) + e.text + latest.slice(e.updateRangeEnd)
    emit('update:text', latest)
    selStart.value = e.selectionStart
    selEnd.value = e.selectionEnd
    caretTick.value += 1
  })
  ec.addEventListener('textformatupdate', (e) => {
    formats.value = e.getTextFormats()
  })
  ec.addEventListener('characterboundsupdate', (e) => {
    boundsRange = [e.rangeStart, e.rangeEnd]
    sendCharacterBounds()
  })
  ec.addEventListener('compositionstart', () => {
    composing.value = true
  })
  ec.addEventListener('compositionend', () => {
    composing.value = false
    formats.value = []
  })

  openedAt = performance.now()
  // preventScroll: bringing a partly visible cell into view would scroll the
  // virtual list, and the list treats a scroll as the end of editing.
  host.focus({ preventScroll: true })
  if (props.startAt) {
    const at = indexAtPointer(props.startAt)
    if (at !== null) setSelection(at)
  }
  syncBounds()
})

onBeforeUnmount(() => {
  if (hostEl.value) hostEl.value.editContext = null
  context = null
})

watch(
  () => props.text,
  (next) => {
    // An edit from elsewhere — the shared input above the grid, or a preset —
    // has to be pushed into the context, which is otherwise the owner of record.
    if (next === latest) return
    latest = next
    context?.updateText(0, context.text.length, next)
    setSelection(Math.min(selStart.value, next.length), Math.min(selEnd.value, next.length))
  },
)

watch(() => props.sample, () => {
  syncBounds()
  sendCharacterBounds()
})

useEventListener(window, 'resize', syncBounds)
useEventListener(hostEl, 'copy', onCopy)
useEventListener(hostEl, 'cut', onCut)
useEventListener(hostEl, 'paste', onPaste)
</script>

<style scoped>
/*
 * Attaching an EditContext makes the element an editing surface as far as the
 * browser is concerned, so it draws a caret of its own at the start of the box
 * — alongside the one drawn from the engine's cluster boxes, which is the only
 * one that knows where the text actually is.
 */
.editor-host {
  position: absolute;
  left: 0;
  top: 0;
  outline: none;
  cursor: text;
  caret-color: transparent;
}
/*
 * Behind the glyphs. The host has to sit above the canvas to receive pointer
 * events, so the highlight is pushed back out through the negative layer of
 * .cell-sample's stacking context.
 */
.selection-box {
  position: absolute;
  z-index: -1;
  background: var(--primary);
  opacity: 0.25;
}
.caret {
  position: absolute;
  background: var(--primary);
  animation: caret-blink 1.1s steps(1) infinite;
}
.composition-bar {
  position: absolute;
  background: var(--foreground);
  opacity: 0.7;
}
@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
