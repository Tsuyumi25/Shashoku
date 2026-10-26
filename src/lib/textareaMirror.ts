/**
 * Where a caret and a selection stand inside a `<textarea>`, in the box's own
 * pixels.
 *
 * The platform will not say. A textarea lays its text out itself and exposes
 * nothing but offsets, so the only way to a rectangle is to set the same string
 * in the same font at the same width somewhere else and read that. This is that
 * copy, kept once and re-laid out per question.
 *
 * Two things need it, and both are about a box that is not the one being typed
 * into: the markup code's own caret, drawn in the row while the keyboard is on
 * the canvas, and the toolbar that stands over whatever is selected.
 */

export interface MirrorRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Everything that can move a glyph sideways or a line downward. Shadow roots
 * and `::first-line` are out of reach of any copy of this kind; the inputs here
 * are plain boxes in the application's own stylesheet, so what is copied is all
 * there is.
 */
const COPIED = [
  'box-sizing',
  'border-bottom-width',
  'border-left-width',
  'border-right-width',
  'border-top-width',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-indent',
  'text-transform',
  'text-align',
  'direction',
  'tab-size',
  'word-break',
  'overflow-wrap',
]

let mirror: HTMLDivElement | null = null

function mirrorFor(el: HTMLTextAreaElement): HTMLDivElement {
  if (mirror === null) {
    mirror = document.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    document.body.append(mirror)
  }
  const style = mirror.style
  style.position = 'fixed'
  style.top = '0'
  style.left = '0'
  style.visibility = 'hidden'
  style.pointerEvents = 'none'
  style.zIndex = '-1'
  style.overflow = 'hidden'

  const from = window.getComputedStyle(el)
  for (const name of COPIED) style.setProperty(name, from.getPropertyValue(name))
  // A textarea wraps and keeps its breaks whatever its `white-space` says; a
  // div only does so when told, and `field-sizing` is not inherited by a box
  // that is being measured rather than typed into.
  style.whiteSpace = 'pre-wrap'
  style.overflowWrap = 'break-word'
  style.width = `${el.offsetWidth}px`
  style.height = 'auto'
  return mirror
}

/** The marker is zero width and, unlike U+200B, no excuse to break a line. */
const MARKER = '\ufeff'

function laidOut(el: HTMLTextAreaElement, pieces: readonly [number, number][]): HTMLSpanElement[] {
  const box = mirrorFor(el)
  box.textContent = ''
  const text = el.value
  const spans: HTMLSpanElement[] = []
  let at = 0
  for (const [start, end] of pieces) {
    box.append(document.createTextNode(text.slice(at, start)))
    const span = document.createElement('span')
    span.textContent = start === end ? MARKER : text.slice(start, end)
    box.append(span)
    spans.push(span)
    at = end
  }
  box.append(document.createTextNode(text.slice(at)))
  return spans
}

/**
 * Rectangles in the box's own coordinates — measured against the mirror's own
 * corner, which stands where the textarea's would if the two were laid over
 * each other, and then moved by however far the box is scrolled.
 */
function localRects(
  el: HTMLTextAreaElement,
  base: DOMRect,
  rects: readonly DOMRect[],
): MirrorRect[] {
  return rects.map((r) => ({
    x: r.left - base.left - el.scrollLeft,
    y: r.top - base.top - el.scrollTop,
    width: r.width,
    height: r.height,
  }))
}

export function textareaCaret(el: HTMLTextAreaElement, index: number): MirrorRect {
  const at = Math.max(0, Math.min(index, el.value.length))
  const [marker] = laidOut(el, [[at, at]])
  const box = mirror as HTMLDivElement
  const [rect] = localRects(el, box.getBoundingClientRect(), [
    (marker as HTMLSpanElement).getBoundingClientRect(),
  ])
  return rect as MirrorRect
}

/** Width given to a selected line break, so a run through it stays visible. */
const BLANK_LINE_SLIVER = 4

export function textareaSelection(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
): MirrorRect[] {
  const limit = el.value.length
  const from = Math.max(0, Math.min(Math.min(start, end), limit))
  const to = Math.max(0, Math.min(Math.max(start, end), limit))
  if (from === to) return []
  const [span] = laidOut(el, [[from, to]])
  const box = mirror as HTMLDivElement
  const rects = Array.from((span as HTMLSpanElement).getClientRects())
  return localRects(el, box.getBoundingClientRect(), rects).map((r) => ({
    ...r,
    width: Math.max(r.width, BLANK_LINE_SLIVER),
  }))
}
