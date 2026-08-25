/**
 * Where the artwork broke the line, given to the readings that cannot say.
 *
 * ⚠️ Only two of the four readers know: one reports where each character sat,
 * and one reads a column at a time. So the reading that wins a place's vote very
 * often has no breaks at all, and has to borrow them from one that has.
 *
 * ⭐ Borrowed by aligning characters, not by dividing the character count. The
 * two readings are nearly the same sentence but rarely the same length, and the
 * extra character is hardly ever spread evenly through — one at the front pushes
 * every proportional break one place left. Alignment is only legitimate because
 * the similarity gate has already established they are the same sentence.
 */
import { flatten } from './vote'
import { sameClaim } from './similar'

/** Anything with text and a confidence. The rest of the reading rides along. */
export interface Breakable {
  text: string
  confidence: number
}

export function settleBreaks<T extends Breakable>(readings: readonly T[]): T[] {
  const templates = readings
    .filter((r) => linesOf(r.text).length > 1)
    // Most lines first: a reading that found three breaks saw more of the
    // artwork than one that found one. Then the surest of those.
    .sort((a, b) => {
      const lines = linesOf(b.text).length - linesOf(a.text).length
      return lines !== 0 ? lines : b.confidence - a.confidence
    })

  return readings.map((reading) => {
    if (linesOf(reading.text).length > 1) return reading
    const said = flatten(reading.text)

    // ⚠️ The gate, and it is the point of doing this at all. Picking on line
    // count and confidence alone lets a model that read something else entirely
    // at this place lend its breaks to the winner, on the strength of having
    // happened to find two lines in its own rubbish.
    const template = templates.find((t) => sameClaim(flatten(t.text), said))
    if (!template) return reading

    const broken = borrow(template.text, said)
    return broken === reading.text ? reading : { ...reading, text: broken }
  })
}

function borrow(template: string, said: string): string {
  const from = [...flatten(template)]
  const to = [...said]
  const at = alignment(from, to)

  const cuts: number[] = []
  let seen = 0
  for (const line of linesOf(template).slice(0, -1)) {
    seen += [...line].length
    const cut = at[seen]
    // A break that lands where the last one did, or on either end, would make an
    // empty line — which is a claim about the artwork nobody made.
    if (cut > (cuts.at(-1) ?? 0) && cut < to.length) cuts.push(cut)
  }
  if (cuts.length === 0) return said

  const lines: string[] = []
  let start = 0
  for (const cut of [...cuts, to.length]) {
    lines.push(to.slice(start, cut).join(''))
    start = cut
  }
  return lines.join('\n')
}

/**
 * For each position between characters of `from`, the position between
 * characters of `to` that stands in the same place.
 *
 * ⚠️ A character `to` has and `from` lacks sits exactly on the boundary when the
 * boundary is a break: the cheapest edit script is the same whether it joins the
 * line before or the line after, so the table cannot answer and something else
 * has to. The later position is taken, which puts it at the end of the line
 * before — because Japanese may not begin a line with a full stop or a closing
 * mark, and those are almost exactly the characters two readers differ by at a
 * break.
 *
 * ⚠️ The cost is an opening bracket, which is the same case pointing the other
 * way and is much rarer.
 */
function alignment(from: readonly string[], to: readonly string[]): number[] {
  const [m, n] = [from.length, to.length]
  const cost: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cost[i][j] = Math.min(
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
        cost[i - 1][j - 1] + (from[i - 1] === to[j - 1] ? 0 : 1),
      )
    }
  }

  // Walked back from the end along the path the table was built for. Row i is
  // recorded the first time the walk reaches it, which — going backwards — is
  // its greatest j.
  const at = new Array<number>(m + 1).fill(0)
  const found = new Array<boolean>(m + 1).fill(false)
  let [i, j] = [m, n]
  at[m] = n
  found[m] = true
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (from[i - 1] === to[j - 1] ? 0 : 1)) {
      i -= 1
      j -= 1
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      i -= 1
    } else {
      j -= 1
    }
    if (!found[i]) {
      at[i] = j
      found[i] = true
    }
  }
  return at
}

function linesOf(text: string): string[] {
  return text.split('\n')
}
