import type { Anchor } from '@/lib/coords'
import type { Rect } from './partition'

/**
 * One drawing of a frame: where the piece of the page it is drawn in stands,
 * and the shape that piece shows. A frame that crosses a boundary is drawn
 * once per piece, each cut to that piece — which is what its own pixels do, so
 * the two cannot come apart.
 */
export interface FrameCopy {
  /**
   * Stable for as long as the frame is drawn in the same piece: these are the
   * elements a gesture is read on, and remounting one under a hand would take
   * the drag out from under it.
   */
  key: string
  /** The piece's travel, in page pixels. */
  offset: Anchor
  /** Nothing where there is nothing to cut, which is a page in one piece. */
  clip?: string
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * One region's shape as a CSS `clip-path`, in page pixels — the coordinates
 * the frames themselves are placed in, so the clip needs no view.
 *
 * Rows of the same width are merged on the way: a region is cut out row by
 * row, and a path of several hundred subpaths is rasterized again on every
 * paint of what it clips.
 */
export function clipPathOf(runs: readonly Rect[]): string {
  const merged: Rect[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.x === run.x && last.w === run.w && run.y <= last.y + last.h) {
      last.h = Math.max(last.h, run.y + run.h - last.y)
      continue
    }
    merged.push({ ...run })
  }
  const path = merged
    .map((r) => `M${round(r.x)} ${round(r.y)}H${round(r.x + r.w)}V${round(r.y + r.h)}H${round(r.x)}Z`)
    .join('')
  return `path("${path}")`
}
