/**
 * What was said at one place, and how many readers said it.
 *
 * ⭐ Three separate cells, and they answer three separate questions. How many
 * readers agreed is what the decision leans on first. What the claim *says* is
 * settled inside the group, from a spelling somebody actually used. Which
 * reading was surest is a third thing again, and is what the transplant and the
 * confidence gates reach for.
 *
 * ⚠️ Keeping them apart is not tidiness. Two readings counting as one claim is
 * emphatically not two readers endorsing either one's spelling — folding them
 * would put two names behind a string nobody wrote.
 */
import type { OcrCandidatePersisted } from '../page/types'

export interface Claim {
  /** How many distinct readers said this. */
  votes: number
  /** Their confidences added up, one per reader, its best. */
  weight: number
  /** The surest single reading of it. */
  confidence: number
  /** A spelling one of them used, chosen inside the group. */
  text: string
  /**
   * The reading whose spelling that is. ⚠️ Not always the surest one: a member
   * that also knows where the artwork broke the line is the better witness to
   * what is written, even if another was more certain of the characters.
   */
  spokesman: OcrCandidatePersisted
  surest: OcrCandidatePersisted
  /** Everything that made this claim, best witness first. */
  readings: OcrCandidatePersisted[]
}

/**
 * Everything said at one place, strongest claim first.
 *
 * ⚠️ Line breaks come out before the comparison. Only two of the four readers
 * can say where the artwork broke a line, so grouping on the broken string
 * would make those two a voting bloc of their own on every balloon — and what
 * is being agreed on is what the artwork *says*, which a break is not part of.
 */
export function claimsOf(readings: readonly OcrCandidatePersisted[]): Claim[] {
  const groups = new Map<string, OcrCandidatePersisted[]>()
  for (const reading of readings) {
    const key = flatten(reading.text)
    const standing = groups.get(key)
    if (standing) standing.push(reading)
    else groups.set(key, [reading])
  }
  return [...groups.values()].map(claimOf).sort(byStrength)
}

function claimOf(readings: OcrCandidatePersisted[]): Claim {
  // One reader's best word, not every word it said. A model that read two boxes
  // of one place is one reader agreeing, however many times it spoke.
  const best = new Map<string, number>()
  for (const reading of readings) {
    best.set(reading.source, Math.max(best.get(reading.source) ?? 0, reading.confidence))
  }

  const ranked = [...readings].sort(bySpelling)
  return {
    votes: best.size,
    weight: [...best.values()].reduce((sum, one) => sum + one, 0),
    confidence: Math.max(...readings.map((r) => r.confidence)),
    text: ranked[0].text,
    spokesman: ranked[0],
    surest: ranked.reduce((a, b) => (b.confidence > a.confidence ? b : a)),
    readings: ranked,
  }
}

/**
 * Which spelling of the group speaks for it: the one that knows where the lines
 * are, then the surest.
 *
 * ⭐ The line count leads. Every member says the same thing, so a member that
 * also says where the artwork broke it is strictly the better witness — and
 * taking it here is what saves the transplant a job it would otherwise have to
 * do by borrowing from another claim entirely.
 *
 * ⚠️ The identity settles what is otherwise a real tie. Two readers can agree on
 * the characters, the breaks and the confidence, and then which of them speaks
 * for the claim would be decided by which finished first — which is the one
 * thing a page's reading must never depend on.
 */
function bySpelling(a: OcrCandidatePersisted, b: OcrCandidatePersisted): number {
  const lines = linesIn(b.text) - linesIn(a.text)
  if (lines !== 0) return lines
  if (b.confidence !== a.confidence) return b.confidence - a.confidence
  return a.hash.localeCompare(b.hash)
}

/**
 * Most agreed on first, then most weight behind it, then most certain — and the
 * identity last, for the same reason as above.
 */
export function byStrength(a: Claim, b: Claim): number {
  if (b.votes !== a.votes) return b.votes - a.votes
  if (b.weight !== a.weight) return b.weight - a.weight
  if (b.confidence !== a.confidence) return b.confidence - a.confidence
  return a.spokesman.hash.localeCompare(b.spokesman.hash)
}

function linesIn(text: string): number {
  return text.split('\n').length
}

/** The reading with nothing said about where its lines fell. */
export function flatten(text: string): string {
  return text.replace(/\n/g, '')
}
