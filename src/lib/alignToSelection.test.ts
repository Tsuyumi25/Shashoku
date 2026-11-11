import { describe, expect, it } from 'vitest'
import type { DrawnLabel } from '@/lib/labelRaster'
import { inkOfLabel, shiftOnto } from './alignToSelection'

/** A 10×4 bitmap centred on (100, 50) whose only ink is columns 6–7, rows 1–2. */
function label(mirror: DrawnLabel['mirror']): DrawnLabel {
  const [w, h] = [10, 4]
  const data = new Uint8ClampedArray(w * h * 4)
  for (const y of [1, 2]) for (const x of [6, 7]) data[(y * w + x) * 4 + 3] = 255
  return {
    sample: { image: { data, width: w, height: h } as ImageData, marks: [], clusters: [], padding: 0 },
    missingFamily: null,
    box: { w, h },
    center: { x: 100, y: 50 },
    mirror,
    plain: '',
  }
}

describe('inkOfLabel', () => {
  it('places the ink where the bitmap puts it on the page', () => {
    expect(inkOfLabel(label({ x: 1, y: 1 }))).toEqual({ x: 101, y: 49, w: 2, h: 2 })
  })

  it('finds ink on the other side of the centre when the object is flipped', () => {
    expect(inkOfLabel(label({ x: -1, y: 1 }))).toEqual({ x: 97, y: 49, w: 2, h: 2 })
  })

  it('has no ink to place for an object that draws nothing', () => {
    expect(inkOfLabel({ ...label({ x: 1, y: 1 }), sample: null })).toBeNull()
  })
})

describe('shiftOnto', () => {
  const ink = { x: 10, y: 20, w: 4, h: 6 }
  const target = { x: 100, y: 200, w: 40, h: 60 }

  it('moves only across, only down, or both', () => {
    expect(shiftOnto(ink, target, 'x')).toEqual({ x: 108, y: 0 })
    expect(shiftOnto(ink, target, 'y')).toEqual({ x: 0, y: 207 })
    expect(shiftOnto(ink, target, 'both')).toEqual({ x: 108, y: 207 })
  })
})
