import { describe, expect, it } from 'vitest'
import { magicWandRaster } from '@/lib/selection/wand'
import { isEmptyRect } from '@/lib/selection/rect'
import type { ShapeRaster } from '@/lib/selection/raster'

const W = 6
const H = 6

/** A page from one character per pixel, each mapped to a flat grey. */
function page(rows: string[], tones: Record<string, number>): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < W; x++) {
      const v = tones[rows[y][x]]
      const i = (y * W + x) * 4
      px[i] = v
      px[i + 1] = v
      px[i + 2] = v
      px[i + 3] = 255
    }
  }
  return px
}

function selected(raster: ShapeRaster, x: number, y: number): boolean {
  const b = raster.bounds
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return false
  return raster.coverage[(y - b.y) * b.w + (x - b.x)] > 0
}

const TONES = { '.': 255, '#': 0, '~': 250 }

describe('magicWandRaster', () => {
  it('takes the run of one flat colour and stops at the wall', () => {
    const px = page(
      ['######', '#....#', '#....#', '#....#', '#....#', '######'],
      TONES,
    )
    const raster = magicWandRaster(px, W, H, { x: 2, y: 2 })
    expect(raster.bounds).toEqual({ x: 1, y: 1, w: 4, h: 4 })
    expect(selected(raster, 2, 2)).toBe(true)
    expect(selected(raster, 0, 0)).toBe(false)
  })

  /** Contiguous by default, so clicking one balloon is not every balloon. */
  it('does not reach a matching region it cannot walk to', () => {
    const px = page(
      ['######', '#.##.#', '#.##.#', '######', '######', '######'],
      TONES,
    )
    const raster = magicWandRaster(px, W, H, { x: 1, y: 1 })
    expect(selected(raster, 1, 2)).toBe(true)
    expect(selected(raster, 4, 1)).toBe(false)
  })

  it('lets tolerance cross a near-identical shade and refuses without it', () => {
    const px = page(
      ['######', '#.~.~#', '######', '######', '######', '######'],
      TONES,
    )
    expect(selected(magicWandRaster(px, W, H, { x: 1, y: 1 }, 32), 4, 1)).toBe(true)
    expect(selected(magicWandRaster(px, W, H, { x: 1, y: 1 }, 0), 2, 1)).toBe(false)
  })

  it('walks round a bend rather than only along the seed row', () => {
    const px = page(
      ['######', '#..###', '#.####', '#.####', '######', '######'],
      TONES,
    )
    const raster = magicWandRaster(px, W, H, { x: 1, y: 1 })
    expect(selected(raster, 2, 1)).toBe(true)
    expect(selected(raster, 1, 3)).toBe(true)
    expect(selected(raster, 2, 2)).toBe(false)
  })

  /** Four-connected, so a colour reachable only across a corner is not taken. */
  it('does not slip through a diagonal gap', () => {
    const px = page(
      ['######', '#.####', '##.###', '######', '######', '######'],
      TONES,
    )
    expect(selected(magicWandRaster(px, W, H, { x: 1, y: 1 }), 2, 2)).toBe(false)
  })

  it('gives nothing for a click off the page', () => {
    const px = page(['......', '......', '......', '......', '......', '......'], TONES)
    expect(isEmptyRect(magicWandRaster(px, W, H, { x: -1, y: 3 }).bounds)).toBe(true)
    expect(isEmptyRect(magicWandRaster(px, W, H, { x: 3, y: 99 }).bounds)).toBe(true)
  })

  it('takes the whole page when the whole page matches', () => {
    const px = page(['......', '......', '......', '......', '......', '......'], TONES)
    const raster = magicWandRaster(px, W, H, { x: 3, y: 3 })
    expect(raster.bounds).toEqual({ x: 0, y: 0, w: W, h: H })
    expect(new Set(raster.coverage)).toEqual(new Set([255]))
  })
})
