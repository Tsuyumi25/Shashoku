/**
 * One point along a gesture, before any dab has been decided from it: where
 * the pointer was, how hard it pressed, and when. Pressure and time ride
 * along unread by this ticket's math — pressure is pinned to 1 by the caller,
 * and nothing here yet has a curve or a filter to hand them to.
 */
export interface BrushSample {
  x: number
  y: number
  pressure: number
  time: number
}

/**
 * One stamp the sampler has decided on. Hardness is missing on purpose: it
 * comes from the stroke's frozen shape and never varies within a stroke, so
 * carrying it on every dab would only be handed back unchanged at the stamp.
 */
export interface Dab {
  x: number
  y: number
  radius: number
  opacity: number
}

/** What a sampler draws dabs at, before a pressure curve can bend it. */
export interface BrushSamplerShape {
  radius: number
  opacity: number
}

/**
 * Spacing as a fraction of a dab's own diameter. `0.25` is what most external
 * brush samples write for this ratio, but that number is against the
 * *radius*; against the diameter, the equivalent is half of it.
 */
export const DEFAULT_BRUSH_SPACING_RATIO = 0.125

/**
 * Turns a gesture's raw samples into dabs, one call at a time.
 *
 * Holds the memory `stampMaskCircle` is not allowed to: where the gesture
 * last was, and how far it has travelled since the last dab. That distance
 * survives from one call to the next, so a call boundary never rounds away
 * whatever distance a segment had left over. A stabilizer's filter state
 * would live in this same closure, next to those two, once one exists —
 * there is nothing to hold until it does.
 *
 * Knows nothing of a pointer's identity and nothing of the DOM a sample came
 * from: a caller hands it page-space samples and reads dabs back.
 */
export interface BrushSampler {
  /** The press. Always yields exactly one dab, at the sample itself. */
  begin(sample: BrushSample): Dab[]
  /** A batch of samples since the last call, oldest first. */
  push(samples: BrushSample[]): Dab[]
  /** The release. Walks to this sample exactly like `push` would — it does
   * not force a dab onto it. */
  end(sample: BrushSample): Dab[]
}

export function createBrushSampler(
  shape: BrushSamplerShape,
  spacingRatio: number = DEFAULT_BRUSH_SPACING_RATIO,
): BrushSampler {
  let last: BrushSample | null = null
  let distanceToNextDab = 0

  function spacingFor(radius: number): number {
    return Math.max(1, radius * 2 * spacingRatio)
  }

  function dabAt(sample: BrushSample): Dab {
    return { x: sample.x, y: sample.y, radius: shape.radius, opacity: shape.opacity }
  }

  function open(sample: BrushSample): Dab[] {
    const dab = dabAt(sample)
    last = sample
    distanceToNextDab = spacingFor(dab.radius)
    return [dab]
  }

  function advance(to: BrushSample): Dab[] {
    const from = last as BrushSample
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    last = to
    if (length === 0) return []

    const dabs: Dab[] = []
    let travelled = 0
    while (distanceToNextDab <= length - travelled) {
      travelled += distanceToNextDab
      const t = travelled / length
      const dab = dabAt({
        x: from.x + dx * t,
        y: from.y + dy * t,
        pressure: from.pressure + (to.pressure - from.pressure) * t,
        time: from.time + (to.time - from.time) * t,
      })
      dabs.push(dab)
      distanceToNextDab = spacingFor(dab.radius)
    }
    distanceToNextDab -= length - travelled
    return dabs
  }

  return {
    begin: open,
    push(samples) {
      const dabs: Dab[] = []
      for (const sample of samples) dabs.push(...(last === null ? open(sample) : advance(sample)))
      return dabs
    },
    end(sample) {
      return last === null ? open(sample) : advance(sample)
    },
  }
}
