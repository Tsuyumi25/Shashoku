/**
 * Cutting a selection's shape out of pixels that already exist.
 *
 * The mask meets the alpha channel, which is the same statement
 * `the-erase-mask-is-a-selection` makes from the other end: a patch's alpha *is*
 * the mask that made it, so a lifted patch and the selection it came from are
 * the same object seen twice rather than two things to keep in step.
 *
 * Straight alpha throughout, not premultiplied, which is what both
 * `putImageData` and PNG want. Filling with a flat colour is the engine's now —
 * that one writes into a layer and so belongs where the tiles are.
 */

/**
 * `rgba` with its alpha scaled by `alpha`, in place, and the colour stripped
 * from whatever the mask took to nothing.
 *
 * The stripping is not tidiness. Under straight alpha a fully transparent pixel
 * can carry colour nothing shows — until something resamples it, at which point
 * bilinear filtering averages the neighbours' colour without consulting their
 * alpha, and a transparent red drags the white beside it pink. The same rule the
 * tiles keep, kept here because this patch never passes through them.
 *
 * `alpha` is the mask's bytes over the same rectangle, row by row, one per
 * pixel.
 */
export function maskPixels(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray): void {
  for (let i = 0; i < alpha.length; i += 1) {
    const at = i * 4
    const kept = Math.round((rgba[at + 3] * alpha[i]) / 255)
    if (kept === 0) {
      rgba[at] = 0
      rgba[at + 1] = 0
      rgba[at + 2] = 0
    }
    rgba[at + 3] = kept
  }
}
