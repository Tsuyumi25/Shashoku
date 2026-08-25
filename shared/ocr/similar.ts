/**
 * Whether two readers said the same thing.
 *
 * ⚠️ Not whether they wrote the same string. Two readers over one balloon differ
 * by a single character constantly — small っ for large つ, one heart short —
 * and counted as two claims that is two votes where there is one. The count is
 * the first thing the page's decision leans on, so a difference like that is a
 * false signal of uncertainty arriving exactly where it does the most harm.
 */

/**
 * Where a reading stops being long enough for a ratio to say anything.
 *
 * ⭐ Below this, two readings are one claim only if they are identical. A sound
 * effect or a single word is where the models are least reliable, so one
 * character apart there is a real disagreement rather than noise, and folding it
 * would report agreement the page does not have.
 *
 * ⚠️ This is the case a ratio alone gets backwards. At five characters a fifth
 * is one whole character, so a ratio starts folding sound effects together the
 * moment they are long enough to round up — which is the shortest, least
 * reliable end, and the last place it should.
 *
 * Descriptive rather than measured, like the two overlap thresholds elsewhere.
 */
export const SHORT_READING = 8

/**
 * How far apart two long readings may be, as a share of the longer.
 *
 * One character in five. On a reading long enough for that to mean anything, one
 * character out is almost always noise — a stroke misread, a mark dropped — and
 * two readers that far apart are agreeing.
 */
export const NEAR = 0.2

export function sameClaim(a: string, b: string): boolean {
  const of = (text: string) => [...text]
  const [left, right] = [of(a), of(b)]
  const longest = Math.max(left.length, right.length)
  return distance(left, right) <= allowance(longest)
}

/** How many characters have to change to turn one reading into the other. */
export function editDistance(a: string, b: string): number {
  return distance([...a], [...b])
}

/**
 * ⚠️ Absolute below the short mark, proportional above it — the two halves of
 * the rule, and they are not the same rule with different numbers.
 */
function allowance(length: number): number {
  return length <= SHORT_READING ? 0 : Math.floor(length * NEAR)
}

/**
 * Levenshtein, over characters rather than code units — a heart and most emoji
 * are one character to a reader and two units to a string, and counting a
 * dropped heart twice would put it over the line a single character stays under.
 *
 * One row at a time, since only the previous one is ever needed and a page holds
 * hundreds of these comparisons.
 */
function distance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, at) => at)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = row
  }
  return previous[b.length]
}
