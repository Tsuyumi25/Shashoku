/** Matches the column advance the engine uses for vertical runs. */
const VERTICAL_COLUMN_EM = 1.2
/** What one character takes down a vertical column, with the room the engine leaves between them. */
const VERTICAL_ADVANCE_EM = 1.05
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

function charEm(ch: string): number {
  // Everything from Hangul Jamo upward is either full-width or ambiguous
  // punctuation that a CJK face draws full-width; guessing wide only costs
  // space, guessing narrow costs the end of the line.
  return (ch.codePointAt(0) ?? 0) >= 0x1100 ? 1 : NARROW_ADVANCE_EM
}

function advanceEm(line: string): number {
  let em = 0
  for (const ch of line) em += charEm(ch)
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
        (box.h - BOX_MARGIN_PX) / (lines.reduce((most, line) => Math.max(most, [...line].length), 1) * VERTICAL_ADVANCE_EM),
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

/** One line of a sample kept in its clipped form: where it starts in the whole text, where in the clipped one, and how much of it is kept. */
export interface KeptLine {
  from: number
  at: number
  length: number
}

export interface ClippedSample {
  text: string
  lines: KeptLine[]
}

/**
 * As much of the text as a box shows at this size: the lines that fit, each cut
 * where it would run out. The engine draws every character it is handed, and a
 * long sample set at the floor is a bitmap many times the cell for every face
 * on screen, nearly all of it never seen.
 *
 * Estimated the way `fittedSize` is, guessing wide, so what is kept fits and
 * the rest of the box may stand a little empty.
 */
export function clipSample(text: string, box: { w: number; h: number }, vertical: boolean, sizePx: number): ClippedSample {
  const runs = Math.max(
    1,
    Math.floor(
      vertical
        ? (box.w - BOX_MARGIN_PX) / (VERTICAL_COLUMN_EM * sizePx)
        : (box.h - BOX_MARGIN_PX) / (LINE_HEIGHT_RATIO * sizePx),
    ),
  )
  const room = (vertical ? box.h : box.w) - BOX_MARGIN_PX
  const lines: KeptLine[] = []
  let from = 0
  let at = 0
  for (const line of text.split('\n')) {
    if (lines.length === runs) break
    let length = 0
    let em = 0
    for (const ch of line) {
      em += vertical ? VERTICAL_ADVANCE_EM : charEm(ch)
      if (em * sizePx > room && length > 0) break
      length += ch.length
    }
    lines.push({ from, at, length })
    from += line.length + 1
    at += length + 1
  }
  return { text: lines.map((l) => text.slice(l.from, l.from + l.length)).join('\n'), lines }
}

/** Where an index into the whole text stands in the clipped one, or null when it was cut away. */
export function shownIndex(clip: ClippedSample, index: number): number | null {
  for (const l of clip.lines) {
    if (index >= l.from && index <= l.from + l.length) return l.at + index - l.from
  }
  return null
}

/** As `shownIndex`, but an index cut away stands at the end of the kept text before it. */
export function nearestShownIndex(clip: ClippedSample, index: number): number {
  for (const l of clip.lines) {
    if (index <= l.from + l.length) return index >= l.from ? l.at + index - l.from : l.at - 1
  }
  return clip.text.length
}

/** Where an index into the clipped text stands in the whole one. */
export function wholeIndex(clip: ClippedSample, index: number): number {
  let line = clip.lines[0]
  for (const l of clip.lines) if (l.at <= index) line = l
  return line === undefined ? index : line.from + Math.min(index - line.at, line.length)
}
