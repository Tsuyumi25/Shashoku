/**
 * One spelling for the things four recognizers spell four ways.
 *
 * ⚠️ This is not tidying. Two readers that read the same balloon and write it
 * `ふん!` and `ふん！` are agreeing, and everything downstream counts how many
 * readers agreed — so left alone they are two claims where there is one, and
 * the count that decides whether an object gets created is quietly wrong.
 *
 * Applied on the way into the pool rather than at the moment of comparison,
 * because the text is part of a reading's identity: folding at comparison time
 * would leave the pool holding both spellings and a rerun adding a third.
 */

/**
 * Compatibility normalization does most of the work in one step — half-width
 * kana widen, their voiced marks compose onto the kana, and the half-width CJK
 * brackets and stops become the ones a page is set in.
 *
 * ⚠️ It runs the *wrong way* for the punctuation below: it folds `！` down to
 * `!` rather than up. So the marks that matter are put back afterwards, which
 * is also what makes the choice of spelling explicit rather than inherited from
 * a Unicode table.
 */
const WIDENED: Record<string, string> = {
  '!': '！',
  '?': '？',
  // A wave dash and a full-width tilde are one mark that Unicode split in two,
  // and which of them a model emits says nothing about the artwork.
  '~': '～',
  '〜': '～',
}

/**
 * Runs of periods, back to the ellipsis they stand for.
 *
 * manga-ocr's own post-processing goes the other way — it writes an ellipsis
 * out as three periods — so without this that reader alone forms its own claim
 * on every balloon that trails off.
 *
 * Three at a time, so six periods are two ellipses rather than one. Two are
 * left alone: they are not an ellipsis and folding them would be inventing one.
 */
const RUN_OF_PERIODS = /\.{3}/g

/** The other ellipsis, which is a different code point and the same mark. */
const MIDLINE_ELLIPSIS = /⋯/g

export function fold(text: string): string {
  const widened = text
    .normalize('NFKC')
    .replace(/[!?~〜]/g, (mark) => WIDENED[mark] ?? mark)
    .replace(MIDLINE_ELLIPSIS, '…')
    .replace(RUN_OF_PERIODS, '…')
  // Trimmed at the ends only. A space inside a reading was read off the artwork
  // and is as much of what is written there as a character is.
  return widened.trim()
}
