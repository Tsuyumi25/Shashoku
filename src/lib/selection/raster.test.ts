import { describe, expect, it } from 'vitest'
import {
  rasterizeEllipse,
  rasterizePolygon,
  rasterizeRect,
  type ShapeRaster,
} from '@/lib/selection/raster'
import { isEmptyRect } from '@/lib/selection/rect'

const PAGE = { w: 16, h: 16 }

function at(raster: ShapeRaster, x: number, y: number): number {
  const b = raster.bounds
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return 0
  return raster.coverage[(y - b.y) * b.w + (x - b.x)]
}

/** Coverage in whole pixels, for comparing against a shape's known area. */
function area(raster: ShapeRaster): number {
  let sum = 0
  for (const v of raster.coverage) sum += v
  return sum / 255
}

describe('rasterizeRect', () => {
  it('is hard edged and snapped to whole pixels', () => {
    const raster = rasterizeRect(PAGE, { x: 2.4, y: 3.6, w: 4.2, h: 4.2 })
    expect(raster.bounds).toEqual({ x: 2, y: 4, w: 5, h: 4 })
    expect(new Set(raster.coverage)).toEqual(new Set([255]))
  })

  it('is cut down to the page', () => {
    const raster = rasterizeRect(PAGE, { x: -4, y: -4, w: 8, h: 8 })
    expect(raster.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('gives nothing for a rect entirely off the page', () => {
    expect(isEmptyRect(rasterizeRect(PAGE, { x: 20, y: 0, w: 4, h: 4 }).bounds)).toBe(true)
  })
})

describe('rasterizeEllipse', () => {
  it('fills the middle, leaves the corners and grades the rim', () => {
    const raster = rasterizeEllipse(PAGE, { x: 2, y: 2, w: 8, h: 8 })
    expect(raster.bounds).toEqual({ x: 2, y: 2, w: 8, h: 8 })
    expect(at(raster, 6, 6)).toBe(255)
    expect(at(raster, 2, 2)).toBe(0)
    const rim = at(raster, 2, 6)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
  })

  it('covers the area of an ellipse', () => {
    const raster = rasterizeEllipse(PAGE, { x: 1, y: 2, w: 10, h: 6 })
    expect(area(raster)).toBeCloseTo(Math.PI * 5 * 3, 0)
  })

  it('is symmetric about its centre', () => {
    const raster = rasterizeEllipse(PAGE, { x: 3, y: 3, w: 9, h: 9 })
    for (let d = 0; d < 5; d++) {
      expect(at(raster, 7 + d, 7)).toBe(at(raster, 7 - d, 7))
      expect(at(raster, 7, 7 + d)).toBe(at(raster, 7, 7 - d))
    }
  })
})

describe('rasterizePolygon', () => {
  it('gives nothing for fewer than three points', () => {
    expect(isEmptyRect(rasterizePolygon(PAGE, [{ x: 1, y: 1 }, { x: 4, y: 4 }]).bounds)).toBe(true)
  })

  it('matches the marquee on an axis-aligned square', () => {
    const square = rasterizePolygon(PAGE, [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 2, y: 6 },
    ])
    expect(square.bounds).toEqual({ x: 2, y: 2, w: 4, h: 4 })
    expect(new Set(square.coverage)).toEqual(new Set([255]))
  })

  it('closes the path itself, so an unfinished lasso still has a region', () => {
    const open = rasterizePolygon(PAGE, [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 8 },
    ])
    expect(area(open)).toBeCloseTo(32, 1)
  })

  it('covers the area of a triangle, rim included', () => {
    const raster = rasterizePolygon(PAGE, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ])
    expect(area(raster)).toBeCloseTo(8, 1)
  })

  /**
   * Non-zero winding rather than even-odd: a lasso drawn round twice, or one
   * that crosses itself on the way home, selects the region it encloses rather
   * than punching a hole in it.
   */
  it('does not hole out a self-crossing loop', () => {
    const bowtie = rasterizePolygon(PAGE, [
      { x: 2, y: 2 },
      { x: 10, y: 2 },
      { x: 2, y: 10 },
      { x: 10, y: 10 },
    ])
    expect(at(bowtie, 6, 3)).toBeGreaterThan(0)
    expect(at(bowtie, 6, 9)).toBeGreaterThan(0)
  })

  it('is cut down to the page', () => {
    const raster = rasterizePolygon(PAGE, [
      { x: -10, y: -10 },
      { x: 4, y: -10 },
      { x: 4, y: 4 },
      { x: -10, y: 4 },
    ])
    expect(raster.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('ignores horizontal segments rather than double counting their ends', () => {
    const withFlat = rasterizePolygon(PAGE, [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 2, y: 6 },
    ])
    expect(area(withFlat)).toBeCloseTo(16, 1)
  })
})
