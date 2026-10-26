/**
 * One block's text cut where a selection starts and ends.
 *
 * `pieces[i]` starts at `offsets[i]` in the text it was cut from, and
 * `seams[i]` is what stood between `pieces[i]` and `pieces[i + 1]` — the pieces
 * joined with their seams give the text back unchanged, so a sentence reads the
 * same after the cut as before it.
 */
export interface CutText {
  pieces: string[]
  offsets: number[]
  seams: string[]
}

/**
 * Cuts `text` at `start` and `end` into up to three pieces: before, selected,
 * after. A line break standing at a cut moves into the seam, since a piece
 * that begins or ends on one would be a block with a blank line in it.
 *
 * Nothing to cut — no selection, or one that is the whole text — answers null.
 */
export function cutText(text: string, start: number, end: number): CutText | null {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(text.length, Math.max(start, end))
  if (from === to) return null

  const raw = [
    { at: 0, text: text.slice(0, from) },
    { at: from, text: text.slice(from, to) },
    { at: to, text: text.slice(to) },
  ]

  const pieces: string[] = []
  const offsets: number[] = []
  const seams: string[] = []
  let pending = ''
  raw.forEach((part, i) => {
    let body = part.text
    let at = part.at
    // Only at a cut: a blank line the text opens or closes on is the text's own.
    while (i > 0 && body.startsWith('\n')) {
      pending += '\n'
      body = body.slice(1)
      at += 1
    }
    let trailing = ''
    while (i < raw.length - 1 && body.endsWith('\n')) {
      trailing += '\n'
      body = body.slice(0, -1)
    }
    if (body.length === 0) {
      pending += trailing
      return
    }
    if (pieces.length > 0) seams.push(pending)
    pieces.push(body)
    offsets.push(at)
    pending = trailing
  })

  return pieces.length > 1 ? { pieces, offsets, seams } : null
}
