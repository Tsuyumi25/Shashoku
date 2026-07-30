/**
 * Colour as the interface carries it: a `#rrggbb` string, which is what CSS
 * takes and what a swatch stores.
 *
 * Alpha is dropped on the way in. What is sampled is the page as it looks, so
 * anything transparent has already been resolved against what is behind it —
 * carrying a channel that says otherwise would let a colour be picked that the
 * eye never saw.
 */

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
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
