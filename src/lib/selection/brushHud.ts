import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@/lib/selection/brushMask'

/**
 * How a drag on the heads-up display maps to a brush, in the two axes
 * Photoshop uses: across for size, down for hardness.
 *
 * Both are measured from where the drag began rather than from the previous
 * frame, so the same distance always means the same brush and coming back to
 * the start comes back to what you had.
 */

/**
 * Screen pixels of travel that multiply the size by `e`. Growth is
 * proportional rather than additive because the range spans three orders of
 * magnitude — a fixed step per pixel is either unusable at 3px or hopeless
 * at 400.
 */
const SIZE_PIXELS_PER_E = 120

/** Screen pixels of travel that span hardness end to end. Down is harder. */
const HARDNESS_SWEEP_PX = 200

export function hudBrushSize(startSize: number, dx: number): number {
  const grown = Math.round(startSize * Math.exp(dx / SIZE_PIXELS_PER_E))
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, grown))
}

export function hudBrushHardness(startHardness: number, dy: number): number {
  // Two decimals, so the readout a person is watching is also what is stored
  // and a drag back to the start lands exactly on the value it left.
  const moved = Math.round((startHardness + dy / HARDNESS_SWEEP_PX) * 100) / 100
  return Math.min(1, Math.max(0, moved))
}
