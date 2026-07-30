import type { Rgb } from '@/lib/color'

/**
 * One colour behind a selection, as the pixels a layer is made of.
 *
 * The mask becomes the alpha channel verbatim, which is the same statement
 * `the-erase-mask-is-a-selection` makes from the other end: a patch's alpha
 * *is* the mask that made it, so a fill and the selection it came from are the
 * same object seen twice rather than two things to keep in step.
 *
 * `alpha` is the mask's bytes inside the layer's own frame, row by row — not
 * the whole page. Straight alpha, not premultiplied, which is what both
 * `putImageData` and PNG want.
 */
export function fillPixels(alpha: Uint8ClampedArray, color: Rgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length * 4)
  for (let i = 0; i < alpha.length; i += 1) {
    const at = i * 4
    out[at] = color.r
    out[at + 1] = color.g
    out[at + 2] = color.b
    out[at + 3] = alpha[i]
  }
  return out
}
