/**
 * Which readings are still worth putting in front of somebody.
 *
 * ⭐ Two saved facts, each living on the end it is true of, and the question is
 * their conjunction:
 *
 * ```
 * the object's source   from?     which reading these words were got from
 * the reading           setAside  somebody said this page has no use for it
 *
 * still offered = !setAside && nothing on the page has taken up this claim
 * ```
 *
 * ⭐ A claim and not a reading, which is the difference between a list worth
 * reading and a list of duplicates. Readers that agree on a balloon character
 * for character are that many readings and one claim; the automatic pass builds
 * one object from the claim's spokesman, and asking only "does an object name
 * *this reading*" would leave the rest standing beside a balloon already
 * answered — offering somebody a choice between a sentence and copies of
 * itself.
 *
 * ⭐ The direction of that edge is the whole design. It hangs on the object —
 * the many side pointing at the one — so that deleting an object, undoing that
 * delete, correcting the words by hand and a rerun turning up something new all
 * come out right with no code to keep any of them in step: the reference travels
 * with the object, and nothing has to remember to tear up a certificate or issue
 * one. Hung on the reading instead, each of those four would be a place somebody
 * has to go back and stamp, which is four chances to forget.
 *
 * Pure, and asked afresh every time. Nothing is stored about which readings are
 * showing; two facts on disk and this answer them.
 */
import type { OcrCandidatePersisted, SourceBody } from '../page/types'
import { placesIn } from './places'
import { claimsOf } from './vote'

/** An object, as far as this question is concerned. */
export interface Claimant {
  source: Pick<SourceBody, 'from'>
}

/**
 * Below this a reading is not put in front of anybody at all.
 *
 * ⭐ A third floor, and the only one about a person's time. The other two are
 * about writing: one guards filling a slot, the other creating an object out of
 * nothing. This one guards a list — a reading nobody would ever pick still costs
 * a row to read past, and a page of hand-drawn lettering has four of them at
 * every balloon.
 *
 * Measured on such a page: three of the four readers scored a median of 0.48 to
 * 0.53 there and were guessing at every one of them, and half of what they said
 * fell under this line. Dropping it left every place with something to show and
 * halved what the lists covered.
 *
 * ⚠️ It hides nothing that was ever seen. The pool keeps these readings, a
 * rerun still finds them, and the page's own decision still weighs them — what
 * this says is only that they are not worth a person's attention, which is a
 * different question from whether they are worth counting.
 */
export const OFFER_FLOOR = 0.55

/**
 * Which readers the floor does not apply to.
 *
 * ⭐ Because a confidence is only comparable between readers who mean the same
 * thing by it. The reader asked about hand-drawn lettering returns lower
 * numbers across the board than the three that read printed type — on the page
 * measured above its median was 0.64 against their 0.48 to 0.53 — and it is the
 * one whose reading is worth looking at there. Held to the same line it would be
 * the first thing cut from exactly the pages that need it.
 *
 * Passed in rather than named here, as `mayNotCreate` is: which readers exist is
 * the caller's to know, and this file has no business holding a list of them.
 */
export function offeredReadings(
  pool: readonly OcrCandidatePersisted[],
  objects: readonly Claimant[],
  ownScale: ReadonlySet<string> = new Set(),
): OcrCandidatePersisted[] {
  const answered = answeredClaims(pool, objects)
  return pool.filter(
    (reading) =>
      !reading.setAside &&
      !answered.has(reading.hash) &&
      (ownScale.has(reading.source) || reading.confidence >= OFFER_FLOOR),
  )
}

/**
 * Every reading the page has answered for: the ones an object names outright,
 * and the ones that were making the same claim in the same place.
 *
 * ⭐ Same claim by the page's own definition of one — `claimsOf`, the rule the
 * votes are counted under. Two readings that count as one voice when the page
 * decides have to count as one voice when it offers, or the same pair is one
 * thing to the court and two things to the reader.
 *
 * ⚠️ Within a place and never across one. Two balloons really do hold the same
 * words — a repeated line, a catchphrase — and answering one is no statement
 * whatever about the other.
 *
 * ⚠️ Readings near enough to be one claim go together even where they are not
 * identical, which above the short mark means a character or two apart. That is
 * the same latitude the count is taken with; if it is ever the wrong latitude,
 * `NEAR` is the place to argue with it rather than here.
 */
function answeredClaims(
  pool: readonly OcrCandidatePersisted[],
  objects: readonly Claimant[],
): ReadonlySet<string> {
  const named = answeredBy(objects)
  if (named.size === 0) return named
  const out = new Set(named)
  for (const place of placesIn(pool)) {
    for (const claim of claimsOf(place.readings)) {
      if (!claim.readings.some((reading) => named.has(reading.hash))) continue
      for (const reading of claim.readings) out.add(reading.hash)
    }
  }
  return out
}

/** Which readings an object on the page names as the words it was made from. */
function answeredBy(objects: readonly Claimant[]): Set<string> {
  const out = new Set<string>()
  for (const object of objects) {
    if (object.source.from !== undefined) out.add(object.source.from)
  }
  return out
}
