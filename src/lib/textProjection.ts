import type { EngineClusterRect } from '@shared/engine/types'

/**
 * Where a caret, a selection and a click land on a run the engine laid out.
 *
 * The one place that reads a cluster table as geometry. Every surface that
 * shows engine-drawn text over a native input goes through here — the font
 * picker's sample cells and the canvas both — so a caret cannot sit in one
 * place on one surface and another place on the other.
 *
 * Everything is in the run's own layout space: the coordinates the engine
 * reports, which stand upright however the bitmap around them was turned. A
 * caller that supplied an angle turns the answer back itself.
 */

/**
 * UTF-16 index → UTF-8 byte offset, with one entry past the end.
 *
 * The seam the whole layer straddles: a native input reports selection in JS
 * string units, and every cluster the engine reports is a byte offset into the
 * same string encoded as UTF-8. Both halves of a surrogate pair carry the
 * offset of the pair, since a caret cannot sit between them.
 */
export function byteOffsets(text: string): number[] {
  const out = new Array<number>(text.length + 1)
  let bytes = 0
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i) as number
    const units = cp > 0xffff ? 2 : 1
    out[i] = bytes
    if (units === 2) out[i + 1] = bytes
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    i += units
  }
  out[text.length] = bytes
  return out
}

export function byteAt(table: readonly number[], index: number): number {
  return table[Math.max(0, Math.min(index, table.length - 1))] ?? 0
}

/** The index whose character contains `byte`, for offsets landing inside one. */
export function indexOfByte(table: readonly number[], byte: number): number {
  for (let i = 0; i < table.length; i += 1) {
    if (table[i] === byte) return i
    if ((table[i] as number) > byte) return Math.max(0, i - 1)
  }
  return table.length - 1
}

export interface ProjectedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextProjectionInput {
  text: string
  /** Every cluster of `text` as the engine placed it. */
  clusters: readonly EngineClusterRect[]
  /** Columns running right to left instead of rows. */
  vertical: boolean
  /** Blank margin the run was laid out with, in layout pixels. */
  padding: number
  /**
   * Extent of the layout box across the writing direction — the bitmap's
   * height when horizontal, its width when vertical. Only consulted when no
   * line has a glyph to measure.
   */
  crossExtent: number
}

export interface TextProjection {
  /** Rows when horizontal, columns when vertical. Never below one. */
  lineCount: number
  lineOf(index: number): number
  /** First and last index of a line, the last being the newline's position. */
  lineRange(line: number): [number, number]
  /**
   * Where the caret sits before `index`, as a line with no thickness — the
   * caller decides how thick a caret is, since that is a screen measure and
   * does not follow the zoom.
   */
  caret(index: number): ProjectedRect
  /** One box per line the range crosses. Empty when the range is collapsed. */
  selection(from: number, to: number): ProjectedRect[]
  /** Nearest caret position to a point in layout space. */
  indexAt(x: number, y: number): number
}

/** Width given to a blank line so a selection running through it stays visible. */
const BLANK_LINE_SLIVER = 4

export function textProjection(input: TextProjectionInput): TextProjection {
  const { text, clusters, vertical, padding, crossExtent } = input

  const table = byteOffsets(text)

  const lineStarts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }

  function lineOf(index: number): number {
    let line = 0
    while (line + 1 < lineStarts.length && (lineStarts[line + 1] as number) <= index) line += 1
    return line
  }

  function lineRange(line: number): [number, number] {
    const start = lineStarts[line] ?? 0
    const next = lineStarts[line + 1]
    return [start, next === undefined ? text.length : next - 1]
  }

  /**
   * Line boxes read off the glyphs rather than by dividing the bitmap between
   * them. The engine rounds the bitmap up to whole pixels and anchors the run
   * to one edge, so dividing that extent back out drifts a fraction of a pixel
   * further with every line. Clusters carry the exact box, and which line each
   * one belongs to is settled by its byte offset rather than by its
   * coordinates.
   */
  const byLine: EngineClusterRect[][] = lineStarts.map(() => [])
  const boundaries = lineStarts.map((index) => table[index] ?? 0)
  for (const rect of clusters) {
    let line = 0
    while (line + 1 < boundaries.length && (boundaries[line + 1] as number) <= rect.cluster) {
      line += 1
    }
    ;(byLine[line] as EngineClusterRect[]).push(rect)
  }

  // Every line box is the same size, so one line with glyphs in it fixes the
  // whole grid — including the empty lines, which have nothing to measure.
  let anchorLine = 0
  let anchorOffset = padding
  let size = (crossExtent - padding * 2) / lineStarts.length
  if (vertical) anchorOffset = crossExtent - padding - size
  for (let line = 0; line < byLine.length; line += 1) {
    const rect = (byLine[line] as EngineClusterRect[])[0]
    if (!rect) continue
    anchorLine = line
    anchorOffset = vertical ? rect.x : rect.y
    size = vertical ? rect.width : rect.height
    break
  }

  /** Where line `n`'s box starts across the writing direction. */
  function lineOffset(line: number): number {
    const step = line - anchorLine
    // Vertical text runs right to left, so a later column sits further left.
    return vertical ? anchorOffset - size * step : anchorOffset + size * step
  }

  /** Which line a point across the writing direction falls in, unclamped. */
  function lineAtOffset(at: number): number {
    if (size <= 0) return anchorLine
    return vertical
      ? anchorLine + Math.ceil((anchorOffset + size - at) / size) - 1
      : anchorLine + Math.floor((at - anchorOffset) / size)
  }

  /** Position along the writing direction of the caret before `index`. */
  function caretMain(index: number): number {
    const byte = byteAt(table, index)
    const rects = byLine[lineOf(index)] ?? []
    const exact = rects.find((r) => r.cluster === byte)
    if (exact) return vertical ? exact.y : exact.x

    let before: EngineClusterRect | undefined
    for (const r of rects) {
      if (r.cluster < byte && (!before || r.cluster > before.cluster)) before = r
    }
    if (before) return vertical ? before.y + before.height : before.x + before.width
    return padding
  }

  function caret(index: number): ProjectedRect {
    const main = caretMain(index)
    const cross = lineOffset(lineOf(index))
    return vertical
      ? { x: cross, y: main, width: size, height: 0 }
      : { x: main, y: cross, width: 0, height: size }
  }

  function selection(from: number, to: number): ProjectedRect[] {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    if (start === end) return []

    const boxes: ProjectedRect[] = []
    for (let line = lineOf(start); line <= lineOf(end); line += 1) {
      const [lineFrom, lineTo] = lineRange(line)
      const head = caretMain(Math.max(start, lineFrom))
      const tail = caretMain(Math.min(end, lineTo))
      const cross = lineOffset(line)
      // A selection that swallows a blank line has nothing there to draw, so it
      // gets a sliver to keep the run continuous. A line the selection merely
      // touches at its edge gets nothing: the end of one line and the start of
      // the next are the same point, and drawing it marks a line that holds
      // none of the selection.
      const blank = lineFrom === lineTo
      if (tail <= head && !blank) continue
      const span = Math.max(tail - head, BLANK_LINE_SLIVER)
      boxes.push(
        vertical
          ? { x: cross, y: head, width: size, height: span }
          : { x: head, y: cross, width: span, height: size },
      )
    }
    return boxes
  }

  function indexAt(x: number, y: number): number {
    const line = Math.max(0, Math.min(lineAtOffset(vertical ? x : y), lineStarts.length - 1))
    const main = vertical ? y : x

    const [start, end] = lineRange(line)
    const rects = byLine[line] ?? []
    if (!rects.length) return start

    const hit = rects.find((r) => {
      const near = vertical ? r.y : r.x
      const span = vertical ? r.height : r.width
      return main >= near && main < near + span
    })
    if (!hit) {
      const first = rects[0] as EngineClusterRect
      return main < (vertical ? first.y : first.x) ? start : end
    }

    const near = vertical ? hit.y : hit.x
    const span = vertical ? hit.height : hit.width
    const index = indexOfByte(table, hit.cluster)
    if (main < near + span / 2) return index
    // Past the halfway point is the position after this cluster, which is
    // where the next one begins — two indices along for a surrogate pair.
    const after = rects.find((r) => r.cluster > hit.cluster)
    return Math.min(after ? indexOfByte(table, after.cluster) : end, end)
  }

  return { lineCount: lineStarts.length, lineOf, lineRange, caret, selection, indexAt }
}
