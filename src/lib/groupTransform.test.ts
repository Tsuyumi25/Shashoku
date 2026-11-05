import { describe, expect, it } from 'vitest'
import { carried, groupBox, groupPoint, stretched, type MemberFrame } from './groupTransform'

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

describe('stretched', () => {
  const pivot = { x: 0, y: 0 }
  const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

  it('moves a member away from the pivot along the stretched axis only', () => {
    const s = stretched({ x: 10, y: 5 }, 0, pivot, 0, { x: 2, y: 1 })
    close(s.center.x, 20)
    close(s.center.y, 5)
  })

  it('stretches a member lying along the box on its own matching axis', () => {
    const s = stretched({ x: 10, y: 0 }, 0, pivot, 0, { x: 2, y: 1 })
    close(s.scaleX, 2)
    close(s.scaleY, 1)
    close(s.rotation, 0)
  })

  /** Its own horizontal is the box's vertical, so a side stretch lands on its other field. */
  it('stretches a member turned a right angle on its other axis', () => {
    const s = stretched({ x: 10, y: 0 }, Math.PI / 2, pivot, 0, { x: 2, y: 1 })
    close(s.scaleX, 1)
    close(s.scaleY, 2)
    close(s.rotation, Math.PI / 2)
  })

  it("measures along the box's own axes once the box has been turned", () => {
    const turn = Math.PI / 6
    const s = stretched({ x: Math.cos(turn) * 10, y: Math.sin(turn) * 10 }, turn, pivot, turn, { x: 3, y: 1 })
    close(s.center.x, Math.cos(turn) * 30)
    close(s.center.y, Math.sin(turn) * 30)
    close(s.scaleX, 3)
    close(s.scaleY, 1)
    close(s.rotation, turn)
  })

  it('leaves everything as it was at a ratio of one', () => {
    const s = stretched({ x: 7, y: -3 }, 0.4, pivot, 0.1, { x: 1, y: 1 })
    close(s.center.x, 7)
    close(s.center.y, -3)
    close(s.rotation, 0.4)
    close(s.scaleX, 1)
    close(s.scaleY, 1)
  })
})
