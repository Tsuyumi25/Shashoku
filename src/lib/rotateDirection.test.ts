import { describe, expect, it } from 'vitest'
import {
  ROTATION_FLIP_THRESHOLD,
  beginRotationDirection,
  resetRotationDirection,
  trackRotationDirection,
  type RotationDirection,
} from './rotateDirection'

const STEP = ROTATION_FLIP_THRESHOLD / 4

/** atan2 only ever reports (-pi, pi], so the fake drag has to wrap the same way. */
function asAtan2(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function drag(state: RotationDirection, ...deltas: number[]) {
  let angle = state.lastAngle
  for (const d of deltas) {
    angle = asAtan2(angle + d)
    trackRotationDirection(state, angle)
  }
  return state
}

describe('trackRotationDirection', () => {
  it('keeps the sign it started with while the drag holds its course', () => {
    const state = beginRotationDirection(1, 0)
    drag(state, STEP, STEP, STEP, STEP, STEP, STEP)
    expect(state.sign).toBe(1)
  })

  it('flips once the reversal has travelled past the threshold', () => {
    const state = beginRotationDirection(1, 0)
    drag(state, -STEP, -STEP, -STEP)
    expect(state.sign).toBe(1)
    drag(state, -STEP, -STEP)
    expect(state.sign).toBe(-1)
  })

  it('does not flip on jitter that never adds up', () => {
    const state = beginRotationDirection(1, 0)
    for (let i = 0; i < 20; i++) drag(state, -STEP, STEP)
    expect(state.sign).toBe(1)
  })

  it('forgets a partial reversal once the drag resumes its course', () => {
    const state = beginRotationDirection(1, 0)
    drag(state, -STEP, -STEP, -STEP)
    drag(state, STEP)
    drag(state, -STEP, -STEP, -STEP)
    expect(state.sign).toBe(1)
  })

  it('reads a step across the atan2 seam as a small step, not a full turn', () => {
    const state = beginRotationDirection(1, Math.PI - STEP / 2)
    // atan2 wraps from just under +pi to just over -pi; the motion is still
    // a tiny clockwise step, so nothing about the direction may change.
    drag(state, STEP)
    expect(state.lastAngle).toBeCloseTo(-Math.PI + STEP / 2, 9)
    expect(state.sign).toBe(1)
    drag(state, STEP, STEP, STEP, STEP)
    expect(state.sign).toBe(1)
  })

  it('flips back and forth on deliberate reversals', () => {
    const state = beginRotationDirection(1, 0)
    drag(state, ...Array(5).fill(-STEP))
    expect(state.sign).toBe(-1)
    drag(state, ...Array(5).fill(STEP))
    expect(state.sign).toBe(1)
  })

  it('starts from the sign it is handed', () => {
    expect(beginRotationDirection(-1, 2).sign).toBe(-1)
    expect(beginRotationDirection(-1, 2).lastAngle).toBe(2)
  })

  it('keeps the sign but drops a half-built reversal when a new drag starts', () => {
    const state = beginRotationDirection(1, 0)
    drag(state, -STEP, -STEP, -STEP)
    resetRotationDirection(state, 2)
    expect(state.sign).toBe(1)
    expect(state.lastAngle).toBe(2)
    drag(state, -STEP, -STEP, -STEP)
    expect(state.sign).toBe(1)
  })
})
