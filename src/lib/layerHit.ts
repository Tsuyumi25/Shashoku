import { stackedRasterNodes, type StackNode } from '@shared/page/stack'
import type { RasterLayerEntry } from '@shared/page/types'
import type { Point } from '@/lib/selection/rect'

/**
 * Which raster layer a point on the page lands on, and which of them wear a
 * frame — one answer, so the two can never disagree.
 *
 * A frame is a rectangle and a patch is mostly transparent, so a page of frames
 * would be a page of invisible walls if the browser were left to decide what a
 * click landed on. It decides by which rectangle is on top; this decides by
 * whether there is a pixel there, which is what the eye decided when it picked
 * the thing to click.
 */

/**
 * One point of one layer's own pixels, in that layer's local whole pixels.
 *
 * Injected because the pixels live in decoded bitmaps that only the renderer
 * holds, and reading one of them means drawing to a canvas. Keeping the fetch
 * outside is what leaves the rule about who wins somewhere it can be read and
 * tested on its own.
 */
export type AlphaReader = (entry: RasterLayerEntry, at: Point) => number

/**
 * Where a layer's pixels actually are.
 *
 * Not the entry's own rectangle, because nothing is written to the manifest
 * before the file it names: a layer being edited keeps the frame it was opened
 * with until its pixels reach disk, which under the pixel scheduler is tens of
 * seconds. Reachability read off the entry therefore stops at the frame from
 * before the stroke — and on a layer first painted this session, where the
 * entry has no frame at all, stops at nothing.
 */
export type FrameReader = (entry: RasterLayerEntry) => {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The raster layers wearing a frame, in drawing order.
 *
 * Read off the stack rather than the tree, which is what makes hiding inherited:
 * the stack is built by skipping what is switched off, and a folder that is off
 * takes everything under it with it. So there is no "can this be seen" walk to
 * write — the list itself is the answer.
 *
 * A locked layer gets none. The frame is what says a thing can be taken hold
 * of, and it is the same sentence as the hit test skipping locked layers, said
 * on the drawing side. A layer with no frame yet — a blank one, before anything
 * has been painted on it — has no box to draw and nothing to grab.
 */
export function framedLayers(
  nodes: readonly StackNode[],
  isLocked: (id: string) => boolean,
  frameOf: FrameReader,
): RasterLayerEntry[] {
  return stackedRasterNodes(nodes)
    .map((node) => node.entry)
    .filter((entry) => {
      const frame = frameOf(entry)
      return frame.w > 0 && frame.h > 0 && !isLocked(entry.id)
    })
}

/**
 * Which layer a page point is on: the topmost one that has a pixel there, or
 * nothing, which is what clicking bare page means.
 *
 * The candidates are exactly the framed ones, so what lights up under the
 * pointer is what a press will take — the two cannot be told apart because
 * they are the same list.
 *
 * A single winner rather than everything under the point. Drilling down through
 * a stack is then something added to this later, not a rewrite of it.
 *
 * Any non-zero alpha counts. A committed layer carries no rotation — a turn is
 * baked into the pixels when the gesture is let go — so the frame is upright and
 * the point is inside it or it is not.
 *
 * The point stays in page pixels the whole way down, including into the alpha
 * reader. A layer's own corner is exactly the thing that is out of date here,
 * and a point measured from it would have to be measured again against the
 * frame the pixels were really read at — two subtractions that only cancel while
 * nothing is being edited.
 */
export function layerAt(
  nodes: readonly StackNode[],
  at: Point,
  isLocked: (id: string) => boolean,
  alphaAt: AlphaReader,
  frameOf: FrameReader,
): string | null {
  const framed = framedLayers(nodes, isLocked, frameOf)
  for (let i = framed.length - 1; i >= 0; i -= 1) {
    const entry = framed[i]
    const frame = frameOf(entry)
    const x = Math.floor(at.x)
    const y = Math.floor(at.y)
    if (x < frame.x || y < frame.y || x >= frame.x + frame.w || y >= frame.y + frame.h) continue
    if (alphaAt(entry, { x, y }) !== 0) return entry.id
  }
  return null
}
