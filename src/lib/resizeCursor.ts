/**
 * The cursor over a scale handle: a straight double-headed arrow along the way
 * the handle pulls, drawn the way the turn cursor is and turned in steps of 15
 * degrees. A double-headed arrow reads the same either way round, so half a
 * turn holds every step there is.
 *
 * CSS's own four resize arrows stay behind it as the fallback, in case the
 * image is refused.
 */

const STEP_DEG = 15
const ARROW = 'M4 12 H20 M7 9 L4 12 L7 15 M17 9 L20 12 L17 15'
const FALLBACKS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const

function svg(turnDeg: number): string {
  const body = `<path d='${ARROW}'/>`
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
 * The CSS cursor for a handle whose outward direction on screen is `angle`
 * radians, measured as `atan2` measures it with y growing downward.
 */
export function resizeCursor(angle: number): string {
  const step = Math.round((angle * 180) / Math.PI / STEP_DEG) * STEP_DEG
  const turn = ((step % 180) + 180) % 180
  const held = made.get(turn)
  if (held) return held
  const fallback = FALLBACKS[Math.round(turn / 45) % 4]
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg(turn))}") 14 14, ${fallback}`
  made.set(turn, css)
  return css
}
