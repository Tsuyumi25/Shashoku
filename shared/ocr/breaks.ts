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
import { costGrid } from './align'
import { flatten } from './vote'
import { sameClaim } from './similar'

/** Anything with text and a confidence. The rest of the reading rides along. */
export interface Breakable {
  text: string
  confidence: number
}

/**
 * When a break given to a reading is worse than none.
 *
 * ⭐ Only breaks this file hands out are ever refused. A reading that found its
 * own breaks is reporting the artwork, however odd the shape looks — a balloon
 * really can be set one character to the line. What is checked here is our
 * guess, and the honest answer to a bad guess is no guess.
 *
 * Two shapes, and they catch the same failure at different sizes. A tall stack
 * of scraps is what proportional sharing produces when the measured columns
 * describe something other than the sentence being placed in them — a run of
 * small marks read as separate lines, a balloon whose columns were found in the
 * artwork around it. Past a certain height it does not matter how the lines
 * fall: nothing anybody letters breaks that often.
 *
 * ⚠️ Descriptive rather than measured, like the thresholds in `similar.ts`. If
 * real breaks start being refused, these are the numbers to argue with.
 */
const LINE_LIMIT = 8
const CROWDED_LINES = 5
const SHORT_LINE = 3
const SHORT_LINES = 3

function shredded(text: string): boolean {
  const lines = linesOf(text)
  if (lines.length > LINE_LIMIT) return true
  if (lines.length < CROWDED_LINES) return false
  return lines.filter((line) => [...line].length <= SHORT_LINE).length >= SHORT_LINES
}

/**
 * `lines` is how long each of the place's measured lines is, along the direction
 * it is read, in the order they are read. It is what answers when no reading
 * here found a break of its own — ⭐ dividing the characters evenly instead
 * would be guessing at the one thing something already went and measured.
 */
export function settleBreaks<T extends Breakable>(
  readings: readonly T[],
  lines: readonly number[],
): T[] {
  const templates = readings
    .filter((r) => linesOf(r.text).length > 1)
    // Most lines first: a reading that found three breaks saw more of the
    // artwork than one that found one. Then the surest of those.
    .sort((a, b) => {
      const count = linesOf(b.text).length - linesOf(a.text).length
      return count !== 0 ? count : b.confidence - a.confidence
    })

  return readings.map((reading) => {
    if (linesOf(reading.text).length > 1) return reading
    const said = flatten(reading.text)

    // ⚠️ The gate, and it is the point of doing this at all. Picking on line
    // count and confidence alone lets a model that read something else entirely
    // at this place lend its breaks to the winner, on the strength of having
    // happened to find two lines in its own rubbish.
    //
    // A reader that read this very sentence and knows where it broke beats a
    // measurement of the ink, because it knows which characters went where and
    // the measurement only knows how much room each line took.
    const template = templates.find((t) => sameClaim(flatten(t.text), said))
    const broken = template ? borrow(template.text, said) : share(said, lines)
    // The reading arrived on one line, so refusing the break is leaving it
    // there — no need to take anything back out.
    if (shredded(broken)) return reading
    return broken === reading.text ? reading : { ...reading, text: broken }
  })
}

/**
 * The characters spread over the measured lines in proportion to their lengths.
 *
 * ⚠️ A last resort, and it says so by what it is not: nobody here knows which
 * character went on which line, so this is the shape of the block rather than a
 * reading of it. It is still much better than an even division — a balloon set
 * five, five and two does not break in thirds, and that is exactly the shape a
 * measurement can see and a character count cannot.
 *
 * A line that would come out empty is dropped rather than kept, for the same
 * reason a transplant never produces one: an empty line is a claim about the
 * artwork that nothing made.
 */
function share(said: string, lines: readonly number[]): string {
  const characters = [...said]
  if (lines.length < 2 || characters.length < 2) return said
  const total = lines.reduce((sum, one) => sum + one, 0)
  if (total <= 0) return said

  const out: string[] = []
  let taken = 0
  let sofar = 0
  lines.forEach((line, at) => {
    sofar += line
    // Measured from the running total rather than by rounding each line on its
    // own, so the rounding error cannot accumulate across a tall balloon.
    const upto =
      at === lines.length - 1
        ? characters.length
        : Math.min(characters.length, Math.round((sofar / total) * characters.length))
    if (upto > taken) {
      out.push(characters.slice(taken, upto).join(''))
      taken = upto
    }
  })
  return out.join('\n')
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
  const cost = costGrid(from, to)

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
