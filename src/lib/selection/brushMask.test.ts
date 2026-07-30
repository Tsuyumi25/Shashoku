import { describe, expect, it } from 'vitest'
import { stampMaskCircle, strokeMask } from '@/lib/selection/brushMask'
import { isEmptyRect } from '@/lib/selection/rect'

const W = 20
const H = 20

function blank(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H)
}

const at = (mask: Uint8ClampedArray, x: number, y: number): number => mask[y * W + x]

describe('stampMaskCircle', () => {
  it('fills the middle and grades the rim of a soft brush', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, 5, 0.5, 'paint')
    expect(at(mask, 10, 10)).toBe(255)
    const rim = at(mask, 14, 10)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
    expect(at(mask, 16, 10)).toBe(0)
  })

  it('leaves no ramp at full hardness', () => {
    const mask = blank()
    stampMaskCircle(mask, W, H, 10, 10, 5, 1, 'paint')
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
    stampMaskCircle(mask, W, H, 10, 10, 5, 0.2, 'paint')
    const once = at(mask, 13, 10)
    stampMaskCircle(mask, W, H, 10, 10, 5, 0.2, 'paint')
    expect(at(mask, 13, 10)).toBe(once)
  })

  it('erases back out of the mask', () => {
    const mask = blank()
    mask.fill(255)
    stampMaskCircle(mask, W, H, 10, 10, 4, 1, 'erase')
    expect(at(mask, 10, 10)).toBe(0)
    expect(at(mask, 0, 0)).toBe(255)
  })

  it('erasing does not lift a value it would not reach', () => {
    const mask = blank()
    mask.fill(60)
    stampMaskCircle(mask, W, H, 10, 10, 5, 0.2, 'erase')
    expect(at(mask, 10, 10)).toBe(0)
    expect(at(mask, 14, 10)).toBe(60)
  })

  it('reports the dirty box, cut down to the page', () => {
    const mask = blank()
    const dirty = stampMaskCircle(mask, W, H, 1, 1, 5, 1, 'paint')
    expect(dirty.x).toBe(0)
    expect(dirty.y).toBe(0)
    expect(at(mask, 0, 0)).toBeGreaterThan(0)
  })

  it('does nothing at zero radius', () => {
    const mask = blank()
    expect(isEmptyRect(stampMaskCircle(mask, W, H, 10, 10, 0, 1, 'paint'))).toBe(true)
    expect(at(mask, 10, 10)).toBe(0)
  })
})

describe('strokeMask', () => {
  it('is a line rather than a row of dots', () => {
    const mask = blank()
    strokeMask(mask, W, H, { x: 3, y: 10 }, { x: 17, y: 10 }, 2, 1, 'paint')
    for (let x = 4; x <= 17; x++) expect(at(mask, x, 10)).toBe(255)
  })

  it('stamps once when the pointer barely moved', () => {
    const mask = blank()
    const dirty = strokeMask(mask, W, H, { x: 10, y: 10 }, { x: 10.2, y: 10 }, 3, 1, 'paint')
    expect(at(mask, 10, 10)).toBe(255)
    expect(dirty.w).toBeLessThan(12)
  })

  it('covers the whole run in the dirty box', () => {
    const mask = blank()
    const dirty = strokeMask(mask, W, H, { x: 4, y: 4 }, { x: 15, y: 15 }, 2, 1, 'paint')
    expect(dirty.x).toBeLessThanOrEqual(2)
    expect(dirty.x + dirty.w).toBeGreaterThanOrEqual(17)
  })
})
