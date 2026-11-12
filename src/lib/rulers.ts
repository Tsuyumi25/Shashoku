import type { ViewTransform } from '@/lib/coords'

/** How thick the rulers stand along the canvas's top and left edges, in screen pixels. */
export const RULER_PX = 18

/** How near a guide or a snap target has to come before it takes hold, in screen pixels. */
export const SNAP_PX = 8

/**
 * The view the rulers measure with: the canvas's, turned back upright about the
 * middle of the canvas, which is where turning the view pivots. Zooming and
 * panning move it; turning the view does not, so the rulers keep still while
 * the page turns under them and agree with the page exactly when it is upright.
 */
export function levelView(view: ViewTransform, container: { w: number; h: number }): ViewTransform {
  if (view.rotate === 0) return view
  const mx = container.w / 2
  const my = container.h / 2
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  // The page point under the middle, from `screen = t + s·R(θ)·page`.
  const ix = (mx - view.tx) / view.scale
  const iy = (my - view.ty) / view.scale
  const px = ix * cos + iy * sin
  const py = -ix * sin + iy * cos
  return { scale: view.scale, rotate: 0, tx: mx - view.scale * px, ty: my - view.scale * py }
}

/**
 * The spacing of a ruler's numbered ticks and of the small ticks between them,
 * in page pixels: the smallest of 1, 2 and 5 times a power of ten that leaves
 * numbered ticks at least 60 screen pixels apart, split in tenths — which then
 * stand at least 6 screen pixels apart.
 */
export function rulerSteps(scale: number): { major: number; minor: number } {
  const want = 60 / scale
  const power = 10 ** Math.floor(Math.log10(want))
  const major = [1, 2, 5, 10].map((k) => k * power).find((step) => step >= want) ?? 10 * power
  return { major, minor: major / 10 }
}

/**
 * The value among `candidates` nearest `value`, if one lies within `reach`;
 * ties go to the earlier candidate.
 */
export function nearestWithin(value: number, candidates: readonly number[], reach: number): number | null {
  let best: number | null = null
  let bestGap = reach
  for (const c of candidates) {
    const gap = Math.abs(c - value)
    if (gap <= bestGap && (best === null || gap < bestGap)) {
      best = c
      bestGap = gap
    }
  }
  return best
}
