import { rectBetween, type Point, type Rect } from '@/lib/selection/rect'

export interface MarqueeDrag {
  origin: Point
  current: Point
  /** Square or circle rather than free proportions. */
  constrain: boolean
  /** The origin is the centre, not a corner. */
  fromCenter: boolean
}

/**
 * The rectangle a marquee drag describes, in page pixels and still floating —
 * snapping to whole pixels belongs to the rasterizer, so that preview and
 * commit round in the same place.
 */
export function marqueeRect(drag: MarqueeDrag): Rect {
  const dx = drag.current.x - drag.origin.x
  const dy = drag.current.y - drag.origin.y
  if (!drag.constrain) {
    if (!drag.fromCenter) return rectBetween(drag.origin, drag.current)
    return { x: drag.origin.x - Math.abs(dx), y: drag.origin.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 }
  }
  // The dominant axis wins, so the shape follows whichever way the hand is
  // actually moving rather than collapsing to the smaller travel.
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  if (drag.fromCenter) {
    return { x: drag.origin.x - side, y: drag.origin.y - side, w: side * 2, h: side * 2 }
  }
  return {
    x: dx < 0 ? drag.origin.x - side : drag.origin.x,
    y: dy < 0 ? drag.origin.y - side : drag.origin.y,
    w: side,
    h: side,
  }
}

/**
 * Photoshop's modifier timing, which a marquee needs because Shift means two
 * different things: held as the drag begins it picks the boolean operation, and
 * pressed once the drag is under way it constrains the proportions. A key that
 * was already down therefore has to be released and pressed again before it
 * changes meaning — otherwise adding to a selection would always square it off.
 */
export function heldSinceStart(downAtStart: boolean, releasedSince: boolean, downNow: boolean): boolean {
  return downNow && (!downAtStart || releasedSince)
}
