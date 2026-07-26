import { ref } from 'vue'
import { clamp, screenDeltaToContentPx, type ViewTransform } from '@/lib/coords'

/**
 * Under this the gesture was a click. Without a threshold a label would creep
 * by a pixel every time it was selected, and the move would land in the undo
 * stack as if it had been asked for.
 */
const DRAG_THRESHOLD_PX = 3

export interface Anchor {
  x: number
  y: number
}

export interface LabelDragOptions {
  /** Where the label sits now, as a fraction of the raw image. */
  anchor: () => Anchor
  natural: () => { w: number; h: number }
  view: () => ViewTransform
  /** On press, before any movement — taking hold of a label selects it. */
  onSelect: () => void
  /** Live position, on every frame the pointer moves. */
  onMove: (to: Anchor) => void
  /**
   * Once on release, and only if the pointer actually travelled, for whoever
   * records it as something undoable.
   */
  onCommit: (from: Anchor, to: Anchor) => void
}

/**
 * Dragging one label around the page. Shared because the text and the marker
 * are two handles on the same anchor, and a handle that moved it differently
 * from the other would be a bug waiting to be found.
 *
 * The pointer is captured on the element the gesture started on, so a fast
 * drag that outruns the label keeps moving it.
 */
export function useLabelDrag(options: LabelDragOptions) {
  const dragging = ref(false)

  let startClient = { x: 0, y: 0 }
  let from: Anchor = { x: 0, y: 0 }
  let latest: Anchor = { x: 0, y: 0 }
  let passedThreshold = false

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging.value = true
    passedThreshold = false
    startClient = { x: e.clientX, y: e.clientY }
    from = options.anchor()
    latest = from
    options.onSelect()
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.value) return
    const dx = e.clientX - startClient.x
    const dy = e.clientY - startClient.y
    if (!passedThreshold && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    passedThreshold = true

    const natural = options.natural()
    if (!natural.w || !natural.h) return
    const delta = screenDeltaToContentPx(dx, dy, options.view())
    // Clamped to the page: the anchor is a fraction of the image, and one
    // parked outside it can no longer be reached to be dragged back.
    latest = {
      x: clamp(from.x + delta.x / natural.w, 0, 1),
      y: clamp(from.y + delta.y / natural.h, 0, 1),
    }
    options.onMove(latest)
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging.value) return
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragging.value = false
    // A cancel arrives here too. Keeping where the label was left beats
    // snapping it back, which loses a deliberate move to an interruption.
    if (passedThreshold) options.onCommit(from, latest)
  }

  return { dragging, onPointerDown, onPointerMove, onPointerUp }
}
