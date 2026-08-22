import { describe, expect, it } from 'vitest'
import type { Rect } from '@/lib/selection/rect'
import {
  NO_PLACEMENT,
  contentBounds,
  hugContent,
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

/** An image whose named pixels carry the given alpha and whose rest is empty. */
function pixels(
  w: number,
  h: number,
  lit: Array<[number, number, number]>,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4)
  for (const [x, y, alpha] of lit) out[(y * w + x) * 4 + 3] = alpha
  return out
}

describe('contentBounds', () => {
  it('finds nothing in an empty patch', () => {
    expect(contentBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull()
  })

  it('holds a single pixel in a box of one', () => {
    expect(contentBounds(pixels(4, 4, [[2, 1, 255]]), 4, 4)).toEqual({ x: 2, y: 1, w: 1, h: 1 })
  })

  it('reaches both extremes on each axis', () => {
    const rgba = pixels(6, 5, [
      [1, 1, 255],
      [4, 3, 255],
    ])
    expect(contentBounds(rgba, 6, 5)).toEqual({ x: 1, y: 1, w: 4, h: 3 })
  })

  it('leaves a full patch exactly as it is', () => {
    const lit: Array<[number, number, number]> = []
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) lit.push([x, y, 255])
    expect(contentBounds(pixels(3, 3, lit), 3, 3)).toEqual({ x: 0, y: 0, w: 3, h: 3 })
  })

  /**
   * The whole reason this exists: a turned rectangle leaves its corners empty,
   * and an untrimmed frame would carry them forever.
   */
  it('reclaims the transparent corners a turn leaves behind', () => {
    const rgba = pixels(5, 5, [
      [2, 1, 255],
      [1, 2, 255],
      [3, 2, 255],
      [2, 3, 255],
    ])
    expect(contentBounds(rgba, 5, 5)).toEqual({ x: 1, y: 1, w: 3, h: 3 })
  })

  /**
   * Antialiasing leaves a ramp of 1, 2, 3 around every turned edge. Keeping
   * them is the only rule that provably changes no picture — a pixel at zero
   * contributes nothing anywhere, and one at 1 does contribute.
   */
  it('counts the faintest edge antialiasing leaves', () => {
    expect(contentBounds(pixels(4, 4, [[3, 3, 1]]), 4, 4)).toEqual({ x: 3, y: 3, w: 1, h: 1 })
  })
})

describe('hugContent', () => {
  const box: Rect = { x: 100, y: 200, w: 4, h: 4 }

  /**
   * The case Ctrl+J arrives in: the box a patch is drawn in is the selection's
   * upright bounding box, and a lasso only fills part of it.
   */
  it('moves the frame onto the content and takes the pixels with it', () => {
    const patch = pixels(4, 4, [
      [1, 1, 255],
      [2, 1, 200],
    ])
    const { frame, data } = hugContent(patch, box)

    expect(frame).toEqual({ x: 101, y: 201, w: 2, h: 1 })
    expect([data[3], data[7]]).toEqual([255, 200])
    expect(data).toHaveLength(2 * 1 * 4)
  })

  it('gives a patch that already fills its box straight back', () => {
    const patch = pixels(4, 4, [
      [0, 0, 255],
      [3, 3, 255],
    ])
    const { frame, data } = hugContent(patch, box)

    expect(frame).toEqual(box)
    expect(data).toBe(patch)
  })

  /** A frame of no area is one the save path skips, so the box stands. */
  it('keeps the box when nothing came through at all', () => {
    const patch = new Uint8ClampedArray(4 * 4 * 4)
    const { frame, data } = hugContent(patch, box)

    expect(frame).toEqual(box)
    expect(data).toBe(patch)
  })
})
