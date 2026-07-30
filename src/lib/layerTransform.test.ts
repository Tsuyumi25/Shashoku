import { describe, expect, it } from 'vitest'
import type { Rect } from '@/lib/selection/rect'
import {
  NO_PLACEMENT,
  isMoved,
  placedFrame,
  type LayerPlacement,
} from '@/lib/layerTransform'

const frame: Rect = { x: 10, y: 20, w: 40, h: 20 }

function place(extra: Partial<LayerPlacement> = {}): LayerPlacement {
  return { ...NO_PLACEMENT, ...extra }
}

describe('isMoved', () => {
  it('says nothing happened for the resting placement', () => {
    expect(isMoved(NO_PLACEMENT)).toBe(false)
  })

  it('notices each of the three on its own', () => {
    expect(isMoved(place({ dx: 1 }))).toBe(true)
    expect(isMoved(place({ scale: 1.5 }))).toBe(true)
    expect(isMoved(place({ rotation: 0.01 }))).toBe(true)
  })
})

describe('placedFrame', () => {
  it('leaves a resting frame exactly where it was', () => {
    expect(placedFrame(frame, NO_PLACEMENT)).toEqual(frame)
  })

  it('carries the frame along without changing its size', () => {
    expect(placedFrame(frame, place({ dx: 5, dy: -3 }))).toEqual({ x: 15, y: 17, w: 40, h: 20 })
  })

  /** Scaling is about the middle, so both edges move and the centre does not. */
  it('grows around the centre', () => {
    expect(placedFrame(frame, place({ scale: 2 }))).toEqual({ x: -10, y: 10, w: 80, h: 40 })
  })

  it('swaps the sides at a quarter turn', () => {
    const turned = placedFrame(frame, place({ rotation: Math.PI / 2 }))
    expect([turned.w, turned.h]).toEqual([20, 40])
    // The middle is what a turn is about, so it is what stays put.
    expect([turned.x + turned.w / 2, turned.y + turned.h / 2]).toEqual([30, 30])
  })

  it('comes back to itself after half a turn', () => {
    expect(placedFrame(frame, place({ rotation: Math.PI }))).toEqual(frame)
  })

  /**
   * The reason decision 8 exists: an upright box cannot hold a turned rectangle
   * without gaining transparent corners, and turning back does not give them up.
   */
  it('grows on a turn that is not a quarter of one', () => {
    const turned = placedFrame(frame, place({ rotation: Math.PI / 4 }))
    expect(turned.w).toBeGreaterThan(frame.w)
    expect(turned.h).toBeGreaterThan(frame.h)
  })

  it("rounds the size up, so the content cannot fall outside the box written for it", () => {
    const turned = placedFrame({ x: 0, y: 0, w: 10, h: 10 }, place({ scale: 1.05 }))
    expect(turned.w).toBe(11)
    expect(turned.h).toBe(11)
  })

  it('lands on whole pixels however fractional the gesture was', () => {
    const turned = placedFrame(frame, place({ dx: 0.4, dy: -0.6, scale: 1.3, rotation: 0.3 }))
    for (const n of [turned.x, turned.y, turned.w, turned.h]) expect(Number.isInteger(n)).toBe(true)
  })
})
