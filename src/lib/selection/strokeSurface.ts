import { clampToPage, EMPTY_RECT, isEmptyRect, unionRect, type Rect } from '@/lib/selection/rect'

/**
 * The coverage one stroke has laid down so far, over the part of the page it
 * has actually reached.
 *
 * A page-sized buffer is the obvious shape and is not affordable: one byte a
 * pixel at the largest page is 139 MB, and a stroke would allocate that on
 * every press. What a stroke covers is a band a few hundred pixels wide however
 * far it wanders, so the region is grown to fit rather than assumed.
 *
 * It is a surface rather than a list of segments because the ceiling needs one:
 * stamps take the stronger value against what is already here, which is what
 * keeps a stroke that crosses itself from darkening where it did.
 */
export interface StrokeSurface {
  region: Rect
  /** One byte a pixel of `region`, row by row. */
  coverage: Uint8ClampedArray
}

export const EMPTY_SURFACE: StrokeSurface = {
  region: EMPTY_RECT,
  coverage: new Uint8ClampedArray(0),
}

/** The least a growth spends, so a slow stroke does not reallocate per pixel. */
const MIN_GROWTH_PAD = 64

function holds(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/**
 * The same surface when it already covers `need`, and a larger one carrying
 * everything the old one held when it does not.
 *
 * Growth is proportional rather than by a fixed margin. A stroke crossing a
 * whole page would otherwise reallocate and copy hundreds of times — quadratic
 * in what it has drawn — where half again each time bounds it at a handful of
 * copies whatever the page measures.
 */
export function surfaceHolding(
  surface: StrokeSurface,
  need: Rect,
  pageW: number,
  pageH: number,
): StrokeSurface {
  const want = clampToPage(need, pageW, pageH)
  if (isEmptyRect(want) || holds(surface.region, want)) return surface

  const union = unionRect(surface.region, want)
  const pad = Math.max(MIN_GROWTH_PAD, Math.ceil(Math.max(union.w, union.h) / 2))
  const region = clampToPage(
    { x: union.x - pad, y: union.y - pad, w: union.w + pad * 2, h: union.h + pad * 2 },
    pageW,
    pageH,
  )
  const coverage = new Uint8ClampedArray(region.w * region.h)
  const was = surface.region
  if (!isEmptyRect(was)) {
    const dx = was.x - region.x
    const dy = was.y - region.y
    for (let row = 0; row < was.h; row++) {
      coverage.set(
        surface.coverage.subarray(row * was.w, (row + 1) * was.w),
        (row + dy) * region.w + dx,
      )
    }
  }
  return { region, coverage }
}

/**
 * The coverage inside `at`, as the engine takes it. `at` must lie inside the
 * surface's own region, which is what every caller has: the box is built from
 * the stamps, and a stamp is clipped to the surface before it lands.
 */
export function coverageWithin(surface: StrokeSurface, at: Rect): Uint8Array {
  const out = new Uint8Array(at.w * at.h)
  const from = surface.region
  for (let row = 0; row < at.h; row++) {
    const start = (at.y + row - from.y) * from.w + (at.x - from.x)
    out.set(surface.coverage.subarray(start, start + at.w), row * at.w)
  }
  return out
}

/**
 * Cuts coverage down to a selection, in place.
 *
 * Multiplied rather than tested against a threshold, so a feathered selection
 * feathers the stroke instead of hard-clipping it — the same thing the fill
 * does, since there the selection *is* the coverage.
 */
export function cutToMask(coverage: Uint8Array, mask: Uint8ClampedArray): void {
  for (let i = 0; i < coverage.length; i++) {
    coverage[i] = Math.round((coverage[i] * mask[i]) / 255)
  }
}
