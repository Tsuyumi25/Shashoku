import { describe, expect, it } from 'vitest'
import {
  clampToPage,
  intersectRect,
  isEmptyRect,
  outsetToPixels,
  rectBetween,
  snapToPixels,
  unionRect,
} from '@/lib/selection/rect'

describe('pixel rounding', () => {
  it('snaps a shape to the nearest boundary and outsets a scan range', () => {
    const drag = { x: 10.4, y: 10.6, w: 5.4, h: 5.1 }
    expect(snapToPixels(drag)).toEqual({ x: 10, y: 11, w: 6, h: 5 })
    expect(outsetToPixels(drag)).toEqual({ x: 10, y: 10, w: 6, h: 6 })
  })

  it('snapping is idempotent on a rect that is already whole', () => {
    const r = { x: 3, y: 4, w: 7, h: 8 }
    expect(snapToPixels(r)).toEqual(r)
  })

  /**
   * The reason snapping exists: the preview drew the raw float rect and the
   * commit outset it, so every edge could disagree by a pixel.
   */
  it('a half-pixel drag lands somewhere, not on both sides at once', () => {
    const r = { x: 2.5, y: 2.5, w: 4, h: 4 }
    const snapped = snapToPixels(r)
    expect(snapped.w).toBe(4)
    expect(snapped.h).toBe(4)
  })
})

describe('rect algebra', () => {
  it('treats a zero-sized rect as nothing', () => {
    const empty = { x: 5, y: 5, w: 0, h: 3 }
    expect(isEmptyRect(empty)).toBe(true)
    expect(unionRect(empty, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 1, y: 1, w: 2, h: 2 })
    expect(unionRect({ x: 1, y: 1, w: 2, h: 2 }, empty)).toEqual({ x: 1, y: 1, w: 2, h: 2 })
  })

  it('unions and intersects', () => {
    const a = { x: 0, y: 0, w: 4, h: 4 }
    const b = { x: 2, y: 3, w: 4, h: 4 }
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, w: 6, h: 7 })
    expect(intersectRect(a, b)).toEqual({ x: 2, y: 3, w: 2, h: 1 })
  })

  it('gives an empty rect when two rects only touch', () => {
    expect(isEmptyRect(intersectRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }))).toBe(
      true,
    )
  })

  it('clamps into the page without ever growing', () => {
    expect(clampToPage({ x: -3, y: -3, w: 10, h: 10 }, 5, 5)).toEqual({ x: 0, y: 0, w: 5, h: 5 })
    expect(isEmptyRect(clampToPage({ x: 8, y: 0, w: 4, h: 4 }, 5, 5))).toBe(true)
  })

  it('reads a drag in either direction', () => {
    expect(rectBetween({ x: 8, y: 9 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, w: 6, h: 6 })
  })
})
