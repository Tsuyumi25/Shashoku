import { describe, expect, it } from 'vitest'
import { stampMaskCircle, strokeMask, type BrushShape } from '@/lib/selection/brushMask'
import { isEmptyRect } from '@/lib/selection/rect'

const W = 20
const H = 20

function blank(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H)
}

const at = (mask: Uint8ClampedArray, x: number, y: number): number => mask[y * W + x]

const shape = (radius: number, hardness: number, opacity = 1): BrushShape => ({
  radius,
  hardness,
  opacity,
})

describe('stampMaskCircle', () => {
  it('fills the middle and grades the rim of a soft brush', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 0.5), 'paint')
    expect(at(mask, 10, 10)).toBe(255)
    const rim = at(mask, 14, 10)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
    expect(at(mask, 16, 10)).toBe(0)
  })

  it('leaves no ramp at full hardness', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1), 'paint')
    expect(at(mask, 14, 10)).toBe(255)
    expect(at(mask, 16, 10)).toBe(0)
  })

  /**
   * One opacity per stroke, as in Photoshop: overlapping stamps take the
   * stronger value rather than adding up, or drawing slowly would come out
   * darker than drawing quickly.
   */
  it('does not build up where stamps overlap', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 0.2), 'paint')
    const once = at(mask, 13, 10)
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 0.2), 'paint')
    expect(at(mask, 13, 10)).toBe(once)
  })

  it('erases back out of the mask', () => {
    const mask = blank()
    mask.fill(255)
    stampMaskCircle(mask, W, H, 10, 10, shape(4, 1), 'erase')
    expect(at(mask, 10, 10)).toBe(0)
    expect(at(mask, 0, 0)).toBe(255)
  })

  it('erasing does not lift a value it would not reach', () => {
    const mask = blank()
    mask.fill(60)
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 0.2), 'erase')
    expect(at(mask, 10, 10)).toBe(0)
    expect(at(mask, 14, 10)).toBe(60)
  })

  it('reports the dirty box, cut down to the page', () => {
    const mask = blank()
    const dirty = stampMaskCircle(mask, W, H, 1, 1, shape(5, 1), 'paint')
    expect(dirty.x).toBe(0)
    expect(dirty.y).toBe(0)
    expect(at(mask, 0, 0)).toBeGreaterThan(0)
  })

  it('does nothing at zero radius', () => {
    const mask = blank()
    expect(isEmptyRect(stampMaskCircle(mask, W, H, 10, 10, shape(0, 1), 'paint'))).toBe(true)
    expect(at(mask, 10, 10)).toBe(0)
  })

  it('caps the fullest part of a stamp at the opacity', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0.5), 'paint')
    expect(at(mask, 10, 10)).toBe(128)
  })

  /**
   * The ceiling is the stroke's, not the stamp's: coming back over ground the
   * same stroke already covered leaves it where it was, which is what decision
   * ② buys and what makes a half-opacity brush usable at all.
   */
  it('does not deepen where a stamp crosses its own opacity', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0.5), 'paint')
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0.5), 'paint')
    expect(at(mask, 10, 10)).toBe(128)
  })

  it('leaves a stronger mask alone rather than thinning it', () => {
    const mask = blank()
    mask.fill(255)
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0.5), 'paint')
    expect(at(mask, 10, 10)).toBe(255)
  })

  /** Half an eraser takes half away, which is the same ceiling facing down. */
  it('erases only as far as the opacity allows', () => {
    const mask = blank()
    mask.fill(255)
    stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0.5), 'erase')
    expect(at(mask, 10, 10)).toBe(128)
  })

  it('does nothing at zero opacity', () => {
    const mask = blank()
    expect(isEmptyRect(stampMaskCircle(mask, W, H, 10, 10, shape(5, 1, 0), 'paint'))).toBe(true)
    expect(at(mask, 10, 10)).toBe(0)
  })
})

describe('strokeMask', () => {
  it('is a line rather than a row of dots', () => {
    const mask = blank()
    strokeMask(mask, W, H, { x: 3, y: 10 }, { x: 17, y: 10 }, shape(2, 1), 'paint')
    for (let x = 4; x <= 17; x++) expect(at(mask, x, 10)).toBe(255)
  })

  it('stamps once when the pointer barely moved', () => {
    const mask = blank()
    const dirty = strokeMask(mask, W, H, { x: 10, y: 10 }, { x: 10.2, y: 10 }, shape(3, 1), 'paint')
    expect(at(mask, 10, 10)).toBe(255)
    expect(dirty.w).toBeLessThan(12)
  })

  it('covers the whole run in the dirty box', () => {
    const mask = blank()
    const dirty = strokeMask(mask, W, H, { x: 4, y: 4 }, { x: 15, y: 15 }, shape(2, 1), 'paint')
    expect(dirty.x).toBeLessThanOrEqual(2)
    expect(dirty.x + dirty.w).toBeGreaterThanOrEqual(17)
  })

  /**
   * The thinnest brush is where spacing has no slack to lose: the stamp is a
   * pixel wide and the spacing is clamped to a pixel, so one stamp too few is a
   * hole rather than a slightly thinner rim.
   */
  it('leaves no hole when the thinnest brush moves under two spacings', () => {
    const mask = blank()
    strokeMask(mask, W, H, { x: 5, y: 10 }, { x: 6.9, y: 10 }, shape(0.5, 1), 'paint')
    expect(at(mask, 6, 10)).toBe(255)
    expect(at(mask, 7, 10)).toBe(255)
  })

  /**
   * A stroke that crosses itself is the case the ceiling exists for: the stamps
   * along the way overlap constantly, so accumulation would show up as a line
   * that darkens wherever the hand slowed down.
   */
  it('holds the ceiling where a stroke crosses itself', () => {
    const mask = blank()
    const half = shape(2, 1, 0.5)
    strokeMask(mask, W, H, { x: 4, y: 10 }, { x: 16, y: 10 }, half, 'paint')
    strokeMask(mask, W, H, { x: 10, y: 4 }, { x: 10, y: 16 }, half, 'paint')
    expect(at(mask, 10, 10)).toBe(128)
  })
})
