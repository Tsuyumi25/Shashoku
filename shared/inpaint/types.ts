/**
 * The renderer-facing shape of AI retouching.
 *
 * A second surface on the same sidecar the OCR models run in, rather than a
 * sixth OCR method: nothing here reads anything. Sharing the process is worth
 * it — one interpreter, one set of torch imports — and sharing the vocabulary
 * would not be, since a caller asking to erase has no model to choose between
 * and no boxes to hand over.
 *
 * Pixels cross as encoded images rather than as paths. The models want files
 * and the main process gives them files, but where those files go is nobody
 * else's business: a region handed over here has never been on disk and has no
 * name, and inventing one for it in the project folder would leave litter
 * behind every failure.
 */

/**
 * A region redrawn wherever its mask covers.
 *
 * `image` and `mask` are encoded pictures of the same size — anything the
 * platform can decode, PNG in practice. Coverage above zero is a hole to be
 * filled: the network wants somewhere to paint rather than a weighting, and
 * what to do with a feathered rim is settled when the answer is composited, not
 * here.
 *
 * The answer covers the whole region, not only the hole. Which part of it to
 * keep is the caller's business, and the caller is the one holding the mask.
 */
export interface InpaintRequest {
  image: Uint8Array
  mask: Uint8Array
}

export interface InpaintResult {
  /** The redrawn region, encoded as PNG, the same size it went in. */
  image: Uint8Array
  width: number
  height: number
}

export interface ShashokuInpaintApi {
  /**
   * Loads the model if it is not loaded, which is seconds and a few hundred
   * megabytes the first time — the caller asking for a region is the decision
   * to pay for it, and nothing is loaded before someone asks.
   */
  erase(request: InpaintRequest): Promise<InpaintResult>
}
