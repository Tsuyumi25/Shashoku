import { describe, expect, it } from 'vitest'
import { offsetSegments, traceMaskSegments } from '@/lib/selection/trace'

function mask(w: number, rows: string[], value = 255): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * rows.length)
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) m[y * w + x] = rows[y][x] === '1' ? value : 0
  }
  return m
}

/** Segments as sorted strings, so a test says which edges exist and not in what order they came. */
function edges(segments: Int32Array): string[] {
  const out: string[] = []
  for (let i = 0; i < segments.length; i += 4) {
    out.push(`${segments[i]},${segments[i + 1]}-${segments[i + 2]},${segments[i + 3]}`)
  }
  return out.sort()
}

const all = (w: number, h: number) => ({ x: 0, y: 0, w, h })

describe('traceMaskSegments', () => {
  it('has nothing for an empty mask', () => {
    expect(edges(traceMaskSegments(mask(3, ['000', '000', '000']), 3, 3, all(3, 3)))).toEqual([])
  })

  it('gives one pixel its four sides', () => {
    expect(edges(traceMaskSegments(mask(3, ['000', '010', '000']), 3, 3, all(3, 3)))).toEqual(
      ['1,1-2,1', '1,1-1,2', '1,2-2,2', '2,1-2,2'].sort(),
    )
  })

  it('draws a solid block as four long sides, not one per pixel', () => {
    expect(edges(traceMaskSegments(mask(4, ['0000', '0110', '0110', '0000']), 4, 4, all(4, 4)))).toEqual(
      ['1,1-3,1', '1,3-3,3', '1,1-1,3', '3,1-3,3'].sort(),
    )
  })

  it('outlines a hole as well as the shape around it', () => {
    const segs = traceMaskSegments(mask(5, ['00000', '01110', '01010', '01110', '00000']), 5, 5, all(5, 5))
    expect(edges(segs)).toEqual(
      ['1,1-4,1', '1,4-4,4', '1,1-1,4', '4,1-4,4', '2,2-3,2', '2,3-3,3', '2,2-2,3', '3,2-3,3'].sort(),
    )
  })

  /**
   * Diagonal neighbours do not touch, as in Photoshop and Clip Studio: each of
   * two pixels meeting at a corner keeps all four sides. Where their sides
   * line up through the corner they are drawn as one straight run, which strokes
   * the same pixels.
   */
  it('keeps every side of two pixels meeting at a corner', () => {
    expect(edges(traceMaskSegments(mask(2, ['10', '01']), 2, 2, all(2, 2)))).toEqual(
      ['0,0-1,0', '0,0-0,1', '1,2-2,2', '2,1-2,2', '0,1-2,1', '1,0-1,2'].sort(),
    )
  })

  it('reads the page edge as outside', () => {
    expect(edges(traceMaskSegments(mask(3, ['100', '000', '000']), 3, 3, all(3, 3)))).toEqual(
      ['0,0-1,0', '0,1-1,1', '0,0-0,1', '1,0-1,1'].sort(),
    )
  })

  it('only scans the region it is given, reading what lies past it as unselected', () => {
    expect(edges(traceMaskSegments(mask(4, ['1000', '0000', '0000', '0001']), 4, 4, { x: 0, y: 0, w: 2, h: 2 }))).toEqual(
      ['0,0-1,0', '0,1-1,1', '0,0-0,1', '1,0-1,1'].sort(),
    )
  })

  /**
   * The 50% contour, which is what Photoshop draws: a feathered rim is inside
   * the ants where it is more than half selected and outside where it is less.
   */
  it('runs along the halfway line of a soft edge', () => {
    expect(edges(traceMaskSegments(mask(3, ['000', '010', '000'], 127), 3, 3, all(3, 3)))).toEqual([])
    expect(edges(traceMaskSegments(mask(3, ['000', '010', '000'], 128), 3, 3, all(3, 3)))).toHaveLength(4)
  })

  it('moves to page coordinates without changing shape', () => {
    const segs = traceMaskSegments(mask(3, ['000', '010', '000']), 3, 3, all(3, 3))
    expect(edges(offsetSegments(segs, 10, 20))).toEqual(['11,21-12,21', '11,21-11,22', '11,22-12,22', '12,21-12,22'].sort())
  })
})
