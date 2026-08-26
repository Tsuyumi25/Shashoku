/**
 * The table two runs of characters are aligned through.
 *
 * ⭐ The table and not the alignment. Two callers here walk one back from the
 * end and want different things out of the walk — one asks where each of a
 * template's line boundaries falls in another reading, the other asks which
 * characters stand in the same column — and each settles a tie its own way for
 * a reason of its own. Sharing the walk would mean sharing those reasons.
 *
 * What is genuinely one thing is the cost table itself, and it is the part
 * worth keeping in step: a substitution and a gap are worth one each, the same
 * arithmetic `similar.ts` measures distance with, so every alignment traced
 * here is a path of that same minimum.
 *
 * ⚠️ Characters rather than code units, as everywhere else that compares
 * readings: a heart is one thing to a reader and two units to a string. The
 * caller splits; this takes what it is given.
 */

/**
 * `grid[i][j]` is the cost of turning the first `i` characters of `a` into the
 * first `j` of `b`. The whole table is kept rather than one row, because what
 * the callers want is the path and not the number at the end of it.
 */
export function costGrid(a: readonly string[], b: readonly string[]): number[][] {
  const grid: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      grid[i][j] = Math.min(
        grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
      )
    }
  }
  return grid
}
