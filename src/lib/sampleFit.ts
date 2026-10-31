/** Matches the column advance the engine uses for vertical runs. */
const VERTICAL_COLUMN_EM = 1.2
/**
 * Widest a character that is not full-width comes out across this font library.
 * Only horizontal needs guessing: a vertical column advances by a constant the
 * engine sets, the same for every face.
 */
const NARROW_ADVANCE_EM = 0.62
/** A line box runs a little taller than the em; measured across this library. */
const LINE_HEIGHT_RATIO = 1.35
/** Room a sample keeps from its box's edge, in CSS pixels. */
const BOX_MARGIN_PX = 8
/**
 * The smallest a sample may be set, as a share of the box across its lines:
 * five lines' worth. Below that a face's shapes can no longer be told apart,
 * and the whole text is on the object anyway — so the sample stops shrinking
 * and lets what does not fit run out of the box. A quarter clipped an ordinary
 * two-line balloon by a pixel at the default display size.
 */
const FLOOR_SHARE = 1 / 5

function advanceEm(line: string): number {
  let em = 0
  for (const ch of line) {
    // Everything from Hangul Jamo upward is either full-width or ambiguous
    // punctuation that a CJK face draws full-width; guessing wide only costs
    // space, guessing narrow costs the end of the line.
    em += (ch.codePointAt(0) ?? 0) >= 0x1100 ? 1 : NARROW_ADVANCE_EM
  }
  return em
}

export interface SampleFit {
  /** The size to set the sample at, in CSS pixels. */
  sizePx: number
  /** Whether the floor held it up, so part of the text runs out of the box. */
  floored: boolean
}

/**
 * The size that fills a box with this text, worked out from the text alone so
 * it is the same for every face: a long sample sets small, a short one large.
 */
export function fittedSize(text: string, box: { w: number; h: number }, vertical: boolean): number {
  const lines = text.split('\n')
  const fit = vertical
    ? Math.min(
        (box.w - BOX_MARGIN_PX) / (VERTICAL_COLUMN_EM * lines.length),
        (box.h - BOX_MARGIN_PX) / (lines.reduce((most, line) => Math.max(most, [...line].length), 1) * 1.05),
      )
    : Math.min(
        (box.w - BOX_MARGIN_PX) / lines.reduce((most, line) => Math.max(most, advanceEm(line)), 1),
        (box.h - BOX_MARGIN_PX) / (LINE_HEIGHT_RATIO * lines.length),
      )
  return Math.max(1, Math.floor(fit))
}

/** As `fittedSize`, but never smaller than the floor. */
export function sampleFit(text: string, box: { w: number; h: number }, vertical: boolean): SampleFit {
  const floor = Math.floor((vertical ? box.w : box.h) * FLOOR_SHARE)
  const sizePx = fittedSize(text, box, vertical)
  return sizePx < floor ? { sizePx: floor, floored: true } : { sizePx, floored: false }
}
