import { describe, expect, it } from 'vitest'
import { traceMaskOutlines } from '@/lib/selection/trace'
import type { Point } from '@/lib/selection/rect'

function mask(w: number, rows: string[], value = 255): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * rows.length)
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) m[y * w + x] = rows[y][x] === '1' ? value : 0
  }
  return m
}

function corners(loop: Point[]): Set<string> {
  return new Set(loop.map((p) => `${p.x},${p.y}`))
}

describe('traceMaskOutlines', () => {
  it('has no loops for an empty mask', () => {
    expect(traceMaskOutlines(mask(3, ['000', '000', '000']), 3, 3, { x: 0, y: 0, w: 3, h: 3 })).toEqual(
      [],
    )
  })

  it('walks one pixel as a four-corner loop', () => {
    const loops = traceMaskOutlines(mask(3, ['000', '010', '000']), 3, 3, { x: 0, y: 0, w: 3, h: 3 })
    expect(loops.length).toBe(1)
    expect(corners(loops[0])).toEqual(new Set(['1,1', '2,1', '2,2', '1,2']))
  })

  it('keeps only the corners of a solid block', () => {
    const loops = traceMaskOutlines(
      mask(4, ['0000', '0110', '0110', '0000']),
      4,
      4,
      { x: 0, y: 0, w: 4, h: 4 },
    )
    expect(loops.length).toBe(1)
    expect(corners(loops[0])).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']))
  })

  it('gives a hole its own loop', () => {
    const loops = traceMaskOutlines(
      mask(5, ['00000', '01110', '01010', '01110', '00000']),
      5,
      5,
      { x: 0, y: 0, w: 5, h: 5 },
    )
    expect(loops.map((l) => l.length).sort()).toEqual([4, 4])
  })

  /** Diagonal neighbours are not connected, as in Photoshop and Clip Studio. */
  it('separates a saddle into two loops instead of a bowtie', () => {
    const loops = traceMaskOutlines(mask(2, ['10', '01']), 2, 2, { x: 0, y: 0, w: 2, h: 2 })
    expect(loops.length).toBe(2)
    expect(loops[0].length).toBe(4)
    expect(loops[1].length).toBe(4)
  })

  it('reads the page edge as outside', () => {
    const loops = traceMaskOutlines(mask(3, ['100', '000', '000']), 3, 3, { x: 0, y: 0, w: 3, h: 3 })
    expect(corners(loops[0])).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']))
  })

  it('only walks the region it is given', () => {
    const loops = traceMaskOutlines(
      mask(4, ['1000', '0000', '0000', '0001']),
      4,
      4,
      { x: 0, y: 0, w: 2, h: 2 },
    )
    expect(loops.length).toBe(1)
    expect(corners(loops[0])).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']))
  })

  /**
   * The 50% contour, which is what Photoshop draws: a feathered rim is inside
   * the ants where it is more than half selected and outside where it is less.
   */
  it('runs along the halfway line of a soft edge', () => {
    const region = { x: 0, y: 0, w: 3, h: 3 }
    expect(traceMaskOutlines(mask(3, ['000', '010', '000'], 127), 3, 3, region)).toEqual([])
    expect(traceMaskOutlines(mask(3, ['000', '010', '000'], 128), 3, 3, region).length).toBe(1)
  })
})
