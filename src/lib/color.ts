/**
 * Colour as the interface carries it: a `#rrggbb` string, which is what CSS
 * takes and what a swatch stores, or `#rrggbbaa` where it is see-through.
 *
 * Alpha is dropped where a colour is sampled. What is sampled is the page as
 * it looks, so anything transparent has already been resolved against what is
 * behind it — carrying a channel that says otherwise would let a colour be
 * picked that the eye never saw.
 */

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

/**
 * `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, hash or not, as the one spelling
 * a colour is stored in: lower case, with a full alpha left off — so an opaque
 * colour reads the same however it was typed, and the same as every colour
 * stored before alpha could be set. Null for anything else.
 */
export function normalHex(raw: string): string | null {
  const body = raw.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(body)) return null
  const long = body.length === 3 || body.length === 4 ? [...body].map((c) => c + c).join('') : body
  if (long.length === 6) return `#${long}`
  if (long.length !== 8) return null
  return long.endsWith('ff') ? `#${long.slice(0, 6)}` : `#${long}`
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * `#rgb` or `#rrggbb` back to channels, or null for anything else. Refused
 * rather than stood in for: a swatch that silently became black would be a
 * fill nobody asked for, landing on pixels that then have to be undone.
 */
export function hexToRgb(hex: string): Rgb | null {
  const body = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]+$/.test(body)) return null
  if (body.length === 3) {
    const [r, g, b] = [...body].map((c) => parseInt(c + c, 16))
    return { r, g, b }
  }
  if (body.length !== 6) return null
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  }
}

/**
 * The colour of one pixel of an RGBA buffer, or null when the point is off it.
 *
 * Coordinates arrive as page pixels, which are fractional because they come
 * from a pointer over a zoomed page. The pixel a person is pointing at is the
 * one they are inside of, so this floors rather than rounds — rounding would
 * sample the neighbour for the whole outer half of every pixel.
 */
export function pixelHexAt(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): string | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= w || py >= h) return null
  const at = (py * w + px) * 4
  return rgbToHex(pixels[at], pixels[at + 1], pixels[at + 2])
}
