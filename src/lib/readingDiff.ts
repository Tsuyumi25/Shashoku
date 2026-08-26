/**
 * Where a place's readings agree, and where they part company.
 *
 * ⭐ Aligned rather than compared position by position. What two readers over
 * one balloon disagree about is almost always a single character — a long mark
 * read as 一, a large つ read as small っ — and one dropped character shifts
 * everything after it. Compared straight, a reading one character short comes
 * out wholly different from the one it agrees with; aligned, exactly the one
 * character that differs is the one marked.
 *
 * ⚠️ This deliberately knows no Japanese, and asking it to would be worse.
 * Morphological analysis was measured on these cases and cannot see them: an
 * OCR error is a *legal* character in the wrong place, so `オ一イ` parses
 * happily into three real words and is flagged as nothing. Which characters two
 * strings hold in common is not a language question.
 */
import { costGrid } from '@shared/ocr/align'
import { editDistance } from '@shared/ocr/similar'

/** A character, and what company it keeps in its column. */
export interface Mark {
  ch: string
  /** Every reading on the card wrote this character here. */
  unanimous: boolean
  /**
   * Which of the column's factions this character belongs to, largest first,
   * or `null` where it stands alone or the column was unanimous.
   *
   * ⭐ Ordered by size so the commonest case gets the lightest treatment. Three
   * readings splitting two against one is the ordinary shape of a
   * disagreement; four splitting two against two is rare, and anything past
   * that needs six readings of one balloon to happen at all.
   */
  faction: number | null
}

/**
 * One entry per reading, in the order they came in, each holding its own
 * characters marked.
 *
 * ⭐ Three standings, not two. A column is unanimous, or it has split into
 * factions somebody has to choose between, or a character in it is claimed by
 * one reading alone. Where three readings run 代名詞 / 代名詞 / 代8詞 the two
 * 名 are a faction and the 8 stands alone; where two readings disagree, neither
 * has company and both stand alone.
 *
 * ⚠️ Standing alone is not the same as being wrong, and nothing here says it
 * is. The reader asked about hand-drawn lettering is regularly the only one
 * that gets a balloon right — what this reports is who has support, which is a
 * different question from who is correct.
 *
 * ⚠️ An empty list for a place offering one reading. A lone reading has nothing
 * to be compared against, and marking it either way would answer a question
 * nobody could have asked — the caller draws it plainly.
 *
 * ⚠️ Characters rather than code units throughout, as in `similar.ts`: a heart
 * is one thing to a reader and two units to a string, and marking half of one
 * would put a colour boundary inside a glyph.
 */
export function markDisagreements(texts: readonly string[]): Mark[][] {
  const rows = texts.map((text) => [...text])
  if (rows.length < 2) return rows.map(() => [])

  const pivot = medoid(texts)
  const centre = rows[pivot]
  const columns = rows.map((row, at) =>
    at === pivot ? row.map((_, i) => String(i)) : columnsAgainst(centre, row),
  )

  /**
   * How many readings wrote each character in each column, and which of them
   * said it first.
   *
   * ⭐ Counted per column rather than decided per pair, so agreement is
   * transitive by construction: three readings that all wrote 名 there are one
   * fact, not three comparisons that have to be kept in step.
   */
  const tally = new Map<string, Map<string, Voice>>()
  rows.forEach((row, at) => {
    row.forEach((ch, j) => {
      const column = tally.get(columns[at][j]) ?? new Map<string, Voice>()
      const held = column.get(ch)
      column.set(ch, { count: (held?.count ?? 0) + 1, first: held?.first ?? at })
      tally.set(columns[at][j], column)
    })
  })

  const verdicts = new Map<string, Map<string, Standing>>()
  for (const [key, column] of tally) verdicts.set(key, standingsIn(column, rows.length))

  return rows.map((row, at) =>
    row.map((ch, j) => ({
      ch,
      ...(verdicts.get(columns[at][j])?.get(ch) ?? ALONE),
    })),
  )
}

type Standing = Omit<Mark, 'ch'>

const ALONE: Standing = { unanimous: false, faction: null }

/** One reading's claim on a column: how many said it, and who said it first. */
interface Voice {
  count: number
  first: number
}

/**
 * What each character in one column stands as.
 *
 * ⚠️ Ties in size go to whichever reading raised the character earlier, so a
 * page marks the same way twice. Two factions of equal size are otherwise at
 * the mercy of insertion order, and the colours would swap between renders.
 */
function standingsIn(column: ReadonlyMap<string, Voice>, total: number): Map<string, Standing> {
  const factions = [...column.entries()]
    .filter(([, voice]) => voice.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .map(([ch]) => ch)

  const out = new Map<string, Standing>()
  for (const [ch, voice] of column) {
    if (voice.count === total) {
      out.set(ch, { unanimous: true, faction: null })
      continue
    }
    const at = factions.indexOf(ch)
    out.set(ch, { unanimous: false, faction: at < 0 ? null : at })
  }
  return out
}

/**
 * Which column each of a reading's characters stands in, named against the
 * pivot's positions.
 *
 * ⭐ Insertions are given columns too, keyed to the pivot character they follow
 * and how far past it they sit. Left out of the coordinates, two readings that
 * both added the same character in the same gap would each look alone there —
 * agreement invisible for want of a place to record it.
 */
function columnsAgainst(centre: readonly string[], row: readonly string[]): string[] {
  const out: string[] = []
  let anchor = -1
  let offset = 0
  for (const [i, j] of alignment(centre, row)) {
    if (j === null) {
      // The pivot has a character here and this reading does not; what follows
      // in this reading is measured from it all the same.
      if (i !== null) {
        anchor = i
        offset = 0
      }
      continue
    }
    if (i === null) {
      offset += 1
      out[j] = `${anchor}+${offset}`
      continue
    }
    anchor = i
    offset = 0
    out[j] = String(i)
  }
  return out
}

/**
 * Which reading to align the rest against: the one nearest all the others.
 *
 * ⭐ Nearest rather than most confident. The pivot is scaffolding, not a
 * verdict — what it has to be is cheap to align everything else to, and the
 * reading in the middle of the group is the one whose alignments distort least.
 * Picking by confidence would let one reader's certainty decide how the others
 * are read.
 *
 * Ties go to the earlier reading, so a place marks the same way twice.
 */
function medoid(texts: readonly string[]): number {
  let best = 0
  let bestCost = Infinity
  texts.forEach((text, at) => {
    const cost = texts.reduce((sum, other) => sum + editDistance(text, other), 0)
    if (cost < bestCost) {
      bestCost = cost
      best = at
    }
  })
  return best
}

/**
 * Which of `a`'s positions each of `b`'s stands at, `null` on either side where
 * one has nothing.
 *
 * ⚠️ Ties are settled in a fixed order, diagonal first. Any order gives a
 * shortest path; only a fixed one gives the same colours to the same page
 * twice.
 */
function alignment(
  a: readonly string[],
  b: readonly string[],
): [number | null, number | null][] {
  const grid = costGrid(a, b)
  const out: [number | null, number | null][] = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && grid[i][j] === grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      out.push([i - 1, j - 1])
      i -= 1
      j -= 1
    } else if (i > 0 && grid[i][j] === grid[i - 1][j] + 1) {
      out.push([i - 1, null])
      i -= 1
    } else {
      out.push([null, j - 1])
      j -= 1
    }
  }
  return out.reverse()
}
