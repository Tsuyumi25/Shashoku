import { describe, expect, it } from 'vitest'
import { heldSinceStart, marqueeRect } from '@/lib/selection/marquee'

const origin = { x: 10, y: 10 }

describe('marqueeRect', () => {
  it('reads a drag in any direction', () => {
    expect(marqueeRect({ origin, current: { x: 4, y: 16 }, constrain: false, fromCenter: false }))
      .toEqual({ x: 4, y: 10, w: 6, h: 6 })
  })

  it('squares off on the axis the hand is moving along', () => {
    expect(marqueeRect({ origin, current: { x: 18, y: 13 }, constrain: true, fromCenter: false }))
      .toEqual({ x: 10, y: 10, w: 8, h: 8 })
  })

  it('squares off backwards too, keeping the origin as the corner', () => {
    expect(marqueeRect({ origin, current: { x: 2, y: 7 }, constrain: true, fromCenter: false }))
      .toEqual({ x: 2, y: 2, w: 8, h: 8 })
  })

  it('grows both ways from the origin when drawing from the centre', () => {
    expect(marqueeRect({ origin, current: { x: 13, y: 15 }, constrain: false, fromCenter: true }))
      .toEqual({ x: 7, y: 5, w: 6, h: 10 })
  })

  it('is a circle about the origin with both modifiers', () => {
    expect(marqueeRect({ origin, current: { x: 15, y: 12 }, constrain: true, fromCenter: true }))
      .toEqual({ x: 5, y: 5, w: 10, h: 10 })
  })

  it('is empty before the pointer has moved', () => {
    const r = marqueeRect({ origin, current: origin, constrain: false, fromCenter: false })
    expect(r.w).toBe(0)
    expect(r.h).toBe(0)
  })
})

/**
 * Shift means two things, so which one it means depends on when it went down:
 * held as the drag begins it adds to the selection, pressed afterwards it
 * squares the shape off.
 */
describe('heldSinceStart', () => {
  it('is true for a key pressed after the drag began', () => {
    expect(heldSinceStart(false, false, true)).toBe(true)
  })

  it('is false for a key that was already down, so adding does not square off', () => {
    expect(heldSinceStart(true, false, true)).toBe(false)
  })

  it('is true again once that key has been let go and pressed anew', () => {
    expect(heldSinceStart(true, true, true)).toBe(true)
  })

  it('is false whenever the key is up', () => {
    expect(heldSinceStart(false, true, false)).toBe(false)
  })
})
