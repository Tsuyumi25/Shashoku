import type { DrawnLabel } from '@/lib/labelRaster'
import { alphaBounds } from '@/lib/layerEffects'
import type { Point, Rect } from '@/lib/selection/rect'

/** Which centre is matched: across, down, or both — Photoshop's two buttons and both pressed. */
export type AlignAxes = 'x' | 'y' | 'both'

/**
 * Where a text object's ink lies on the page, or null when it draws nothing.
 *
 * The ink and not the frame, so a line ending in a question mark or an
 * ellipsis is centred on what is seen of it rather than on the box the layout
 * left around it.
 */
export function inkOfLabel(drawn: DrawnLabel): Rect | null {
  const image = drawn.sample?.image
  if (!image) return null
  const box = alphaBounds(image.data, image.width, image.height)
  if (box === null) return null
  // The bitmap is centred on `center` and mirrored about it, so a box offset
  // from the bitmap's middle lands that far from `center`, the other way round
  // on a flipped axis.
  const across = drawn.mirror.x * (box.x + box.w / 2 - image.width / 2)
  const down = drawn.mirror.y * (box.y + box.h / 2 - image.height / 2)
  return {
    x: drawn.center.x + across - box.w / 2,
    y: drawn.center.y + down - box.h / 2,
    w: box.w,
    h: box.h,
  }
}

/** How far `ink` has to travel for its centre to meet `target`'s on the axes asked for. */
export function shiftOnto(ink: Rect, target: Rect, axes: AlignAxes): Point {
  return {
    x: axes === 'y' ? 0 : target.x + target.w / 2 - (ink.x + ink.w / 2),
    y: axes === 'x' ? 0 : target.y + target.h / 2 - (ink.y + ink.h / 2),
  }
}
