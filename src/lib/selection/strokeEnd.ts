import type { Point } from '@/lib/selection/rect'
import type { MaskBrushMode } from '@/lib/selection/brushMask'

/** Which brush a point was left by: one per surface and mode, as Photoshop keeps one per tool. */
export type StrokeKind = `${'layer' | 'mask'}:${MaskBrushMode}`

/**
 * Where a brush last let go, which Shift and a click draws a straight line on
 * from — Photoshop's way, and the one hands trained on it reach for.
 *
 * ⭐ Holds only while nothing has happened to the history since. Measured
 * against Photoshop: an undo, a redo, or any other step in between — a new
 * layer, a fill — and the next Shift-click starts a new line instead of
 * joining one; a setting that is not a step, the brush's size, leaves it.
 * Without this, undoing a line left its far end standing, and the next line
 * was drawn from a point no longer on the page.
 *
 * `step` is the history's count once the stroke's own step was pushed, and
 * null while that push is still on its way — no undo can run in that gap,
 * since a stroke in flight holds the history still.
 */
interface StrokeEnd {
  page: string
  at: Point
  step: number | null
}

const ends = new Map<StrokeKind, StrokeEnd>()

/** At the release. What comes back is handed to `settle` or `forget` once the step is known. */
export function rememberStrokeEnd(kind: StrokeKind, page: string, at: Point): StrokeEnd {
  const end: StrokeEnd = { page, at: { x: at.x, y: at.y }, step: null }
  ends.set(kind, end)
  return end
}

/** The stroke's step is in the history, which now stands at `step`. */
export function settleStrokeEnd(end: StrokeEnd, step: number): void {
  end.step = step
}

/** The stroke never became a step: it drew nothing, or failed. */
export function forgetStrokeEnd(kind: StrokeKind, end: StrokeEnd): void {
  if (ends.get(kind) === end) ends.delete(kind)
}

/** Where a line drawn now starts, or null when this press starts a new one. */
export function lineStartOn(kind: StrokeKind, page: string, step: number): Point | null {
  const end = ends.get(kind)
  if (end === undefined || end.page !== page) return null
  return end.step === null || end.step === step ? end.at : null
}

/**
 * The pressure a line is drawn at. A pen reports nothing at the moment it
 * touches down, and a line opened from that would be drawn at no width.
 */
export function linePressure(pressure: number): number {
  return Number.isFinite(pressure) && pressure > 0 && pressure <= 1 ? pressure : 1
}
