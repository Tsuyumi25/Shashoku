import { describe, expect, it } from 'vitest'
import { hudBrushHardness, hudBrushSize } from './brushHud'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from './brushMask'

describe('hudBrushSize', () => {
  it('leaves the brush alone until the drag moves', () => {
    expect(hudBrushSize(40, 0)).toBe(40)
  })

  it('grows and shrinks by the same factor for the same distance', () => {
    const out = hudBrushSize(40, 120)
    const back = hudBrushSize(40, -120)
    expect(out).toBe(Math.round(40 * Math.E))
    expect(back).toBe(Math.round(40 / Math.E))
  })

  it('moves a small brush by small amounts and a large one by large', () => {
    expect(hudBrushSize(4, 24) - 4).toBeLessThan(hudBrushSize(400, 24) - 400)
  })

  it('stops at both ends', () => {
    expect(hudBrushSize(400, 9999)).toBe(MAX_BRUSH_SIZE)
    expect(hudBrushSize(4, -9999)).toBe(MIN_BRUSH_SIZE)
  })
})

describe('hudBrushHardness', () => {
  it('leaves hardness alone until the drag moves', () => {
    expect(hudBrushHardness(0.8, 0)).toBe(0.8)
  })

  it('hardens downward and softens upward', () => {
    expect(hudBrushHardness(0.5, 100)).toBe(1)
    expect(hudBrushHardness(0.5, -100)).toBe(0)
  })

  it('stops at both ends', () => {
    expect(hudBrushHardness(0.8, 9999)).toBe(1)
    expect(hudBrushHardness(0.8, -9999)).toBe(0)
  })

  it('lands back on the value it started from', () => {
    expect(hudBrushHardness(0.63, 40)).toBe(0.83)
    expect(hudBrushHardness(0.83, -40)).toBe(0.63)
  })
})
