/**
 * One point along a gesture, before any dab has been decided from it: where
 * the pointer was, how hard it pressed, and when.
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
 * last was, how far it has travelled since the last dab, and the
 * stabilizer's own trailing position. All three survive from one call to
 * the next, so a call boundary never rounds away a segment's leftover
 * distance or resets how far the smoothed path has fallen behind.
 *
 * Knows nothing of a pointer's identity and nothing of the DOM a sample came
 * from: a caller hands it page-space samples and reads dabs back.
 */
export interface BrushSampler {
  /** The press. Always yields exactly one dab, at the sample itself. */
  begin(sample: BrushSample): Dab[]
  /** A press that opens as a straight run from `from` to `to`, unsmoothed:
   * Shift and a click, drawing on from where the last stroke ended. */
  beginLine(from: BrushSample, to: BrushSample): Dab[]
  /** A batch of samples since the last call, oldest first. */
  push(samples: BrushSample[]): Dab[]
  /** The release. Unlike `push`, walks straight to this sample's own
   * position rather than the stabilizer's trailing one, so a stroke never
   * ends with a stretch the smoothing left unwalked. */
  end(sample: BrushSample): Dab[]
}

/**
 * Causal, forward-only smoothing over a stroke's path: each conditioned
 * sample is pulled toward the last position the stroke settled on, by a
 * fixed fraction, before it is used to place dabs. `0` leaves samples
 * untouched.
 *
 * A stroke's edge is only ever this filter's *input* clipped by where dabs
 * fall — nothing already placed is revisited, which is the one thing a
 * retroactive smoother could not promise once coverage has taken a ceiling.
 */
export function createBrushSampler(
  shape: BrushSamplerShape,
  spacingRatio: number = DEFAULT_BRUSH_SPACING_RATIO,
  stabilization: number = 0,
): BrushSampler {
  let last: BrushSample | null = null
  let distanceToNextDab = 0
  let lastValidPressure: number | null = null

  function spacingFor(radius: number): number {
    return Math.max(1, radius * 2 * spacingRatio)
  }

  function dabAt(sample: BrushSample): Dab {
    return {
      x: sample.x,
      y: sample.y,
      radius: shape.radius * sample.pressure,
      opacity: shape.opacity,
    }
  }

  /**
   * The Pointer Events spec fixes `pointerup.pressure` at `0`, and a pen
   * reports the same `0` at `pointerdown` — measured against real hardware,
   * every opening sample of a stroke, before the tip's own force has been
   * sampled. Mid-stroke, falling back to the last valid reading is right.
   * At the opening there is no last reading to fall back to, so falling back
   * to `0` there is what lets the first segment's interpolation taper the
   * stroke up from nothing instead of starting at full force.
   */
  function condition(sample: BrushSample): BrushSample {
    const p = sample.pressure
    if (Number.isFinite(p) && p > 0 && p <= 1) {
      lastValidPressure = p
      return sample
    }
    return { ...sample, pressure: lastValidPressure ?? 0 }
  }

  function stabilize(sample: BrushSample): BrushSample {
    if (stabilization <= 0) return sample
    const from = last as BrushSample
    const pull = 1 - stabilization
    return {
      ...sample,
      x: from.x + (sample.x - from.x) * pull,
      y: from.y + (sample.y - from.y) * pull,
    }
  }

  function open(sample: BrushSample): Dab[] {
    const conditioned = condition(sample)
    const dab = dabAt(conditioned)
    last = conditioned
    distanceToNextDab = spacingFor(dab.radius)
    return [dab]
  }

  /** Walks from `last` to `to` exactly, at the configured spacing. Whether
   * `to` is a stabilized position or a raw one is the caller's call. */
  function walkTo(to: BrushSample): Dab[] {
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
    beginLine(from, to) {
      return [...open(from), ...walkTo(condition(to))]
    },
    push(samples) {
      const dabs: Dab[] = []
      for (const sample of samples) {
        dabs.push(...(last === null ? open(sample) : walkTo(stabilize(condition(sample)))))
      }
      return dabs
    },
    end(sample) {
      return last === null ? open(sample) : walkTo(condition(sample))
    },
  }
}
