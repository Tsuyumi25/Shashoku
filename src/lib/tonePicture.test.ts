import { describe, expect, it } from 'vitest'
import type { ToneEffect } from '@shared/effects/types'
import { drawnTurn, type Flip } from './flip'
import { labelToneGrid, pageGrid, screenPixels, type PlacedLabel, type SheetGrid } from './tonePicture'

const SIDE = 120
const GRID: SheetGrid = pageGrid(0, 0)
const TONE: ToneEffect = { kind: 'tone', spacing: 8, angle: 45, density: 'image' }

/** A square of one colour, straight RGBA. */
function flat(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIDE * SIDE * 4)
  for (let i = 0; i < out.length; i += 4) out.set([r, g, b, a], i)
  return out
}

function screened(ink: Uint8ClampedArray, tone: ToneEffect = TONE): Uint8ClampedArray {
  const out = ink.slice()
  screenPixels(ink, out, null, SIDE, SIDE, GRID, tone)
  return out
}

function meanAlpha(px: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 3; i < px.length; i += 4) sum += px[i]!
  return sum / (px.length / 4) / 255
}

describe('a picture as screentone film', () => {
  it('lays no ink where it is white, so what is underneath shows', () => {
    expect(meanAlpha(screened(flat(255, 255, 255, 255)))).toBe(0)
  })

  it('lays as much ink as the grey would darken white paper', () => {
    expect(meanAlpha(screened(flat(128, 128, 128, 255)))).toBeCloseTo(0.5, 1)
  })

  it('thins a soft edge into smaller dots instead of fading solid black', () => {
    const edge = screened(flat(0, 0, 0, 77))
    expect(meanAlpha(edge)).toBeCloseTo(0.3, 1)
    const alphas = new Set<number>()
    for (let i = 3; i < edge.length; i += 4) alphas.add(edge[i]!)
    expect(alphas.has(255)).toBe(true)
    expect(alphas.has(0)).toBe(true)
  })

  it('scales a fixed density by the alpha too', () => {
    expect(meanAlpha(screened(flat(255, 255, 255, 128), { ...TONE, density: 60 }))).toBeCloseTo(0.3, 1)
  })
})

describe('a label with its fill screened', () => {
  it('leaves a stroke the fill never reached exactly as it was', () => {
    const whole = flat(255, 255, 255, 255)
    const out = whole.slice()
    screenPixels(flat(0, 0, 0, 0), out, whole, SIDE, SIDE, GRID, TONE)
    expect(out).toEqual(whole)
  })

  it('keeps the part of a stroke that lies over the fill on top of the dots', () => {
    // Half a white stroke plus half a black fill, the two shares summed.
    const fill = flat(0, 0, 0, 128)
    const whole = flat(128, 128, 128, 255)
    const out = whole.slice()
    screenPixels(fill, out, whole, SIDE, SIDE, GRID, TONE)
    let white = 0
    for (let i = 0; i < out.length; i += 4) white += (out[i]! * out[i + 3]!) / 255
    expect(white / (out.length / 4) / 255).toBeCloseTo(0.5, 1)
  })

  it('is only dots where there are no strokes', () => {
    const fill = flat(128, 128, 128, 255)
    const out = fill.slice()
    screenPixels(fill, out, fill, SIDE, SIDE, GRID, TONE)
    expect(meanAlpha(out)).toBeCloseTo(0.5, 1)
    for (let i = 0; i < out.length; i += 4) expect(out[i]).toBe(0)
  })
})

describe('screentone on a text object', () => {
  /** A grey square label placed with its anchor, screened as `paintLabel` would. */
  function screenedAt(label: PlacedLabel, origin: { x: number; y: number }): Uint8ClampedArray {
    const fill = flat(128, 128, 128, 255)
    const out = fill.slice()
    screenPixels(fill, out, fill, SIDE, SIDE, labelToneGrid(label, origin), TONE)
    return out
  }

  it('carries its dots along when the object moves, like a sheet stuck to it', () => {
    const here: PlacedLabel = { center: { x: 200.5, y: 150.5 }, mirror: { x: 1, y: 1 }, spin: 0, width: SIDE, height: SIDE }
    const moved: PlacedLabel = { ...here, center: { x: 213.5, y: 156.5 } }
    expect(screenedAt(moved, { x: 193, y: 146 })).toEqual(screenedAt(here, { x: 180, y: 140 }))
  })

  it('keeps every point of the letters under the same ink however the object is turned or flipped', () => {
    const origin = { x: 300, y: 200 }
    /** Where the frame's centre sits from the stored point, before turning and flipping. */
    const offset = { x: 7, y: 3 }
    const upright = screenedAt(
      { center: { x: origin.x + offset.x, y: origin.y + offset.y }, mirror: { x: 1, y: 1 }, spin: 0, width: SIDE, height: SIDE },
      origin,
    )

    const cases: [number, Flip][] = [
      [Math.PI / 2, { x: false, y: false }],
      [Math.PI / 2, { x: true, y: false }],
      [0, { x: true, y: true }],
      [Math.PI, { x: false, y: true }],
    ]
    for (const [rotation, flip] of cases) {
      const { turn: spin, mirror } = drawnTurn(rotation, flip)
      // The object's own flip and turn carry the frame's centre around the stored point.
      const fx = flip.x ? -offset.x : offset.x
      const fy = flip.y ? -offset.y : offset.y
      const center = {
        x: origin.x + Math.cos(rotation) * fx - Math.sin(rotation) * fy,
        y: origin.y + Math.sin(rotation) * fx + Math.cos(rotation) * fy,
      }
      const turned = screenedAt({ center, mirror, spin, width: SIDE, height: SIDE }, origin)
      // The engine puts the letters' point b at R(spin)·b from the bitmap's centre.
      const c = Math.round(Math.cos(spin))
      const n = Math.round(Math.sin(spin))
      for (let j = 0; j < SIDE; j += 7) {
        for (let i = 0; i < SIDE; i += 7) {
          const bx = i + 0.5 - SIDE / 2
          const by = j + 0.5 - SIDE / 2
          const ti = Math.round(c * bx - n * by + SIDE / 2 - 0.5)
          const tj = Math.round(n * bx + c * by + SIDE / 2 - 0.5)
          const want = upright[(j * SIDE + i) * 4 + 3]!
          const got = turned[(tj * SIDE + ti) * 4 + 3]!
          expect(Math.abs(got - want), `rotation ${rotation}, flip ${JSON.stringify(flip)}, at ${i},${j}`).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
