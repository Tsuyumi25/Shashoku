import { describe, expect, it } from 'vitest'
import { carried, groupBox, groupPoint, type MemberFrame } from './groupTransform'

const upright = (x: number, y: number, w: number, h: number): MemberFrame => ({
  center: { x, y },
  w,
  h,
  rotation: 0,
})

describe('groupBox', () => {
  it('is the plain union of upright members at no turn', () => {
    const box = groupBox([upright(10, 10, 4, 4), upright(30, 20, 10, 2)], 0)
    expect(box).toEqual({ centerX: 21.5, centerY: 14.5, width: 27, height: 13 })
  })

  it('stays tight round a set turned as one', () => {
    const turn = Math.PI / 6
    const a = upright(0, 0, 10, 4)
    const b = upright(20, 0, 10, 4)
    const turned = [a, b].map((m) => ({
      ...m,
      center: carried(m.center, { x: 10, y: 0 }, turn, 1),
      rotation: turn,
    }))
    const box = groupBox(turned, turn)!
    expect(box.width).toBeCloseTo(30)
    expect(box.height).toBeCloseTo(4)
    expect(box.centerX).toBeCloseTo(10)
    expect(box.centerY).toBeCloseTo(0)
  })
})

describe('carried', () => {
  it('keeps the pivot where it is and scales distances from it', () => {
    const pivot = { x: 5, y: 5 }
    expect(carried(pivot, pivot, 1.3, 2)).toEqual(pivot)
    const p = carried({ x: 7, y: 5 }, pivot, 0, 3)
    expect(p.x).toBeCloseTo(11)
    expect(p.y).toBeCloseTo(5)
  })

  it('swings a centre round the pivot by the turn', () => {
    const p = carried({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2, 1)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })
})

describe('groupPoint', () => {
  it('reads a corner of a turned box where the turn put it', () => {
    const box = { centerX: 0, centerY: 0, width: 20, height: 10 }
    const corner = groupPoint(box, Math.PI / 2, { x: 1, y: 1 })
    expect(corner.x).toBeCloseTo(-5)
    expect(corner.y).toBeCloseTo(10)
  })
})
