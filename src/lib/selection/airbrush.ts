import type { Dab } from './brushSampler'

/** Stamps a second an airbrush lays where the pen rests. */
export const AIRBRUSH_RATE = 40

/**
 * Keeps stamping the stroke's last dab at wherever the pen is now, until the
 * returned stop is called. Spacing only ever stamps for distance travelled, so
 * a resting pen lays nothing without this.
 */
export function sprayWhileHeld(lastDab: () => Dab | null, at: () => { x: number; y: number }, stamp: (dab: Dab) => void): () => void {
  const timer = window.setInterval(() => {
    const dab = lastDab()
    if (dab === null) return
    const { x, y } = at()
    stamp({ ...dab, x, y })
  }, 1000 / AIRBRUSH_RATE)
  return () => clearInterval(timer)
}
