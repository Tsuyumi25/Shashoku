import { describe, expect, it } from 'vitest'
import {
  boundsOfMask,
  composeInto,
  normalizeOp,
  regionFor,
} from '@/lib/selection/mask'
import { rasterizeRect } from '@/lib/selection/raster'
import type { Rect } from '@/lib/selection/rect'

const W = 8
const H = 8
const PAGE = { w: W, h: H }
const WHOLE: Rect = { x: 0, y: 0, w: W, h: H }

function maskOfRect(r: Rect, value = 255): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(W * H)
  for (let y = r.y; y < r.y + r.h; y++) mask.fill(value, y * W + r.x, y * W + r.x + r.w)
  return mask
}

function composed(
  base: Uint8ClampedArray | null,
  shape: Rect,
  op: Parameters<typeof composeInto>[5],
): Uint8ClampedArray {
  const raster = rasterizeRect(PAGE, shape)
  const out = new Uint8ClampedArray(W * H)
  if (base) out.set(base)
  composeInto(out, base, W, H, raster, op, WHOLE)
  return out
}

describe('boundsOfMask', () => {
  it('is null when nothing is selected', () => {
    expect(boundsOfMask(new Uint8ClampedArray(W * H), W, H)).toBeNull()
  })

  it('is the box round every non-zero value, feathered ones included', () => {
    const mask = maskOfRect({ x: 2, y: 3, w: 3, h: 2 }, 1)
    expect(boundsOfMask(mask, W, H)).toEqual({ x: 2, y: 3, w: 3, h: 2 })
  })

  it('only looks inside the region it is given', () => {
    const mask = new Uint8ClampedArray(W * H)
    mask[0] = 255
    mask[W * 7 + 7] = 255
    expect(boundsOfMask(mask, W, H, { x: 4, y: 4, w: 4, h: 4 })).toEqual({
      x: 7,
      y: 7,
      w: 1,
      h: 1,
    })
  })
})

describe('regionFor', () => {
  const held = { x: 0, y: 0, w: 4, h: 4 }
  const shape = { x: 3, y: 3, w: 4, h: 4 }

  it('unions for new, because the old selection has to be cleared', () => {
    expect(regionFor('new', held, shape)).toEqual({ x: 0, y: 0, w: 7, h: 7 })
  })

  it('is the shape alone for add', () => {
    expect(regionFor('add', held, shape)).toEqual(shape)
  })

  it('is only where the two meet for subtract', () => {
    expect(regionFor('subtract', held, shape)).toEqual({ x: 3, y: 3, w: 1, h: 1 })
  })

  it('is the whole held selection for intersect, which can shrink anywhere', () => {
    expect(regionFor('intersect', held, shape)).toEqual(held)
  })
})

describe('normalizeOp', () => {
  it('leaves every op alone while something is selected', () => {
    const held = { x: 0, y: 0, w: 1, h: 1 }
    for (const op of ['new', 'add', 'subtract', 'intersect'] as const) {
      expect(normalizeOp(op, held)).toBe(op)
    }
  })

  it('turns add and intersect into a plain new selection when nothing is held', () => {
    expect(normalizeOp('add', null)).toBe('new')
    expect(normalizeOp('intersect', null)).toBe('new')
  })

  it('refuses to subtract from nothing', () => {
    expect(normalizeOp('subtract', null)).toBeNull()
  })
})

describe('composeInto', () => {
  const base = maskOfRect({ x: 0, y: 0, w: 4, h: 4 })
  const shape: Rect = { x: 2, y: 2, w: 4, h: 4 }

  it('replaces for new, clearing what the shape does not reach', () => {
    const out = composed(base, shape, 'new')
    expect(out[0]).toBe(0)
    expect(out[2 * W + 2]).toBe(255)
    expect(out[5 * W + 5]).toBe(255)
  })

  it('takes the stronger of the two for add', () => {
    const out = composed(base, shape, 'add')
    expect(out[0]).toBe(255)
    expect(out[5 * W + 5]).toBe(255)
  })

  it('takes the weaker of the two for intersect', () => {
    const out = composed(base, shape, 'intersect')
    expect(out[0]).toBe(0)
    expect(out[3 * W + 3]).toBe(255)
    expect(out[5 * W + 5]).toBe(0)
  })

  it('subtracts strength rather than clipping, so a soft edge survives', () => {
    const soft = maskOfRect({ x: 0, y: 0, w: 4, h: 4 }, 200)
    const raster = rasterizeRect(PAGE, { x: 0, y: 0, w: 2, h: 2 })
    raster.coverage.fill(80)
    const out = new Uint8ClampedArray(soft)
    composeInto(out, soft, W, H, raster, 'subtract', WHOLE)
    expect(out[0]).toBe(120)
    expect(out[3]).toBe(200)
  })

  it('reads a missing base as nothing selected', () => {
    const out = composed(null, shape, 'new')
    expect(out[2 * W + 2]).toBe(255)
    expect(out[0]).toBe(0)
  })

  /**
   * What lets a preview redraw only the pixels it dirtied last frame: every
   * output is a function of the base and the shape at that pixel, so a region
   * wider than the operation needs is more work and never a different answer.
   */
  it('gives the same answer over a wider region', () => {
    const narrow = new Uint8ClampedArray(base)
    const wide = new Uint8ClampedArray(base)
    const raster = rasterizeRect(PAGE, shape)
    composeInto(narrow, base, W, H, raster, 'add', regionFor('add', null, raster.bounds))
    composeInto(wide, base, W, H, raster, 'add', WHOLE)
    expect([...narrow]).toEqual([...wide])
  })
})

