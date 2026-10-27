/**
 * The cursor over the band just outside a frame: a quarter arc bowed away from
 * the object, an arrowhead at each end, the way Photoshop draws it.
 *
 * Drawn bowing toward the top right with the arc's middle on the hotspot, then
 * turned to whichever way that part of the frame faces on screen, in steps of
 * 45 degrees — a cursor is an image, so it cannot follow the object's angle
 * exactly, and eight is what reads as "this side" at a glance.
 */

const ARC = 'M2.56 9.9 A9 9 0 0 1 14.1 21.44'
const HEADS = 'M6.28 10.69 L2.56 9.9 L4.9 6.91 M17.09 19.1 L14.1 21.44 L13.31 17.72'

function svg(turnDeg: number): string {
  const body = `<path d='${ARC}'/><path d='${HEADS}'/>`
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<g transform='rotate(${turnDeg} 12 12)'>` +
    `<g stroke='white' stroke-width='4.5'>${body}</g>` +
    `<g stroke='black' stroke-width='1.8'>${body}</g>` +
    `</g></svg>`
  )
}

const made = new Map<number, string>()

/**
 * The CSS cursor for a corner whose outward direction on screen is `angle`
 * radians, measured as `atan2` measures it with y growing downward.
 */
export function rotateCursor(angle: number): string {
  const step = Math.round(((angle * 180) / Math.PI + 45) / 45) * 45
  const turn = ((step % 360) + 360) % 360
  const held = made.get(turn)
  if (held) return held
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg(turn))}") 14 14, grab`
  made.set(turn, css)
  return css
}
