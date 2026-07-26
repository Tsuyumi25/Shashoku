/**
 * How far a drag has to double back before it counts as changing direction.
 * Without it, the jitter in a slow drag strobes whatever the sign drives.
 */
export const ROTATION_FLIP_THRESHOLD = (5 * Math.PI) / 180

export interface RotationDirection {
  /** 1 turns clockwise on screen, -1 counter-clockwise. */
  sign: 1 | -1
  lastAngle: number
  reversal: number
}

export function beginRotationDirection(sign: 1 | -1, angle: number): RotationDirection {
  return { sign, lastAngle: angle, reversal: 0 }
}

/** Starts a fresh drag from wherever the last one left the sign. */
export function resetRotationDirection(state: RotationDirection, angle: number): void {
  state.lastAngle = angle
  state.reversal = 0
}

export function trackRotationDirection(state: RotationDirection, angle: number): void {
  // atan2 reports (-pi, pi], so a step across the seam arrives as nearly a full
  // turn the other way. Fold it back to the short way round.
  let delta = angle - state.lastAngle
  if (delta > Math.PI) delta -= 2 * Math.PI
  else if (delta < -Math.PI) delta += 2 * Math.PI
  state.lastAngle = angle
  if (delta === 0) return
  if (Math.sign(delta) === state.sign) {
    state.reversal = 0
    return
  }
  state.reversal += Math.abs(delta)
  if (state.reversal >= ROTATION_FLIP_THRESHOLD) {
    state.sign = delta > 0 ? 1 : -1
    state.reversal = 0
  }
}
