import { clampToPage, EMPTY_RECT, isEmptyRect, unionRect, type Rect } from '@/lib/selection/rect'

export type MaskBrushMode = 'paint' | 'erase'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500
export const DEFAULT_BRUSH_SIZE = 40
export const DEFAULT_BRUSH_HARDNESS = 0.8
export const DEFAULT_BRUSH_OPACITY = 1

/**
 * What a stamp is shaped by, apart from where it lands. Radius in page pixels;
 * the other two are fractions.
 *
 * `opacity` is the brush's, not the colour's: it is the ceiling on coverage
 * this stroke can reach, which is the thing that makes taking the stronger
 * value mean anything. A brush that always arrived at 255 would have no
 * ceiling to stop under.
 */
export interface BrushShape {
  radius: number
  hardness: number
  opacity: number
}

/**
 * One round stamp of the brush into a selection mask. `hardness` at 1 is a hard
 * edge; below that the rim falls off linearly to nothing at the radius.
 *
 * Two of the painting brush's arguments are absent on purpose. Locking
 * transparent pixels means nothing to a mask, which has no colour to protect,
 * and neither does honouring the selection — here the brush *is* the selection
 * being drawn.
 *
 * Stamps take the stronger of what is already there rather than accumulating,
 * so a stroke drawn slowly does not come out darker than the same stroke drawn
 * quickly. Within one stroke the brush has one opacity, as it does in
 * Photoshop; building up is what a second stroke is for.
 */
export function stampMaskCircle(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  shape: BrushShape,
  mode: MaskBrushMode,
): Rect {
  const { radius, hardness, opacity } = shape
  const bounds = clampToPage(
    {
      x: Math.floor(cx - radius) - 1,
      y: Math.floor(cy - radius) - 1,
      w: Math.ceil(radius * 2) + 3,
      h: Math.ceil(radius * 2) + 3,
    },
    w,
    h,
  )
  if (isEmptyRect(bounds) || radius <= 0 || opacity <= 0) return EMPTY_RECT

  // Kept under 1 so a fully hard brush still has a one-pixel ramp to sit on,
  // rather than dividing by a zero-width falloff.
  const inner = radius * Math.min(0.999, hardness)
  const y1 = bounds.y + bounds.h
  const x1 = bounds.x + bounds.w

  for (let y = bounds.y; y < y1; y++) {
    const row = y * w
    for (let x = bounds.x; x < x1; x++) {
      const dist = Math.hypot(x - cx, y - cy)
      if (dist > radius) continue
      const strength = dist <= inner ? 1 : 1 - (dist - inner) / (radius - inner)
      if (strength <= 0) continue
      const value = strength * opacity * 255
      const held = mask[row + x]
      if (mode === 'paint') {
        if (value > held) mask[row + x] = value
      } else if (255 - value < held) {
        mask[row + x] = 255 - value
      }
    }
  }
  return bounds
}

/**
 * A stroke as stamps along the way, so a fast drag is a line rather than a row
 * of dots. Returns where the last stamp landed, which is where the next segment
 * has to start from.
 */
export function strokeMask(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  shape: BrushShape,
  mode: MaskBrushMode,
): Rect {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const step = Math.max(1, shape.radius * 0.25)
  const steps = Math.floor(dist / step)
  if (steps === 0) return stampMaskCircle(mask, w, h, to.x, to.y, shape, mode)

  let dirty = EMPTY_RECT
  for (let i = 1; i <= steps; i++) {
    const stamp = stampMaskCircle(
      mask,
      w,
      h,
      from.x + (dx * i) / steps,
      from.y + (dy * i) / steps,
      shape,
      mode,
    )
    dirty = unionRect(dirty, stamp)
  }
  return dirty
}
