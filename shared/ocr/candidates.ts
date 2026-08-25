/**
 * The candidates: what was read where this object stands.
 *
 * ⭐ The list is the place's, not a radius around the object. What counts as one
 * place is worked out over the whole pool at once, by the same rule the page's
 * own decision uses — so the rows offered here are exactly the readings the
 * decision was choosing between, rather than a second, looser opinion about
 * which readings are nearby.
 *
 * Recomputed on every ask and never stored: move the object and it is a
 * different list.
 */
import type { OcrCandidatePersisted, SourceBody } from '../page/types'
import { distanceTo, nearEnough, placesIn, type Point } from './places'
import { claimsOf } from './vote'

/**
 * One candidate for this object's source.
 *
 * What the object already says appears here too, as the entry whose `hash` is
 * `own` — a candidate like any other, but with no confidence and no place on
 * the page, because those words are the object's rather than a measurement.
 */
export interface SourceCandidate {
  hash: string | 'own'
  source: string
  text: string
  confidence: number | null
  /** Null for the object's own source, and so is `label`. */
  distance: number | null
  label: string | null
  /**
   * ⭐ The answer is a row of this list and not a box above it — shown by
   * marking the row, and put where it is easy to find by ordering it first.
   */
  held: boolean
}

/**
 * What the list shows for one object.
 *
 * `centre` is where the object visually sits, not the anchor it is stored by —
 * the anchor means a different corner depending on how the text is aligned.
 *
 * The own row always leads, empty or not: it is the one row that is always
 * offered, and a row that is always there is what lets there be no separate
 * "write your own" button.
 *
 * ⚠️ The reading in the slot stands right after it, whatever place it came from:
 * an object carried across the page still stands for what somebody said it
 * stands for, and a list that dropped it would report the choice as unmade.
 */
export function candidatesFor(
  object: { source: SourceBody },
  centre: Point,
  pool: readonly OcrCandidatePersisted[],
): SourceCandidate[] {
  const held = object.source.from ?? 'own'

  // A reading somebody set aside is off the list for good — see
  // `shared/ocr/offer.ts`, which asks the same question for the page at large.
  const here = placesIn(pool.filter((reading) => !reading.setAside))
    .filter((place) => nearEnough(centre, place))
    .map((place) => ({ place, apart: distanceTo(centre, place) }))
    .sort((a, b) => a.apart - b.apart)[0]

  // Strongest claim first, and within a claim the reading that spoke for it —
  // the same order the decision weighed them in, so the row it would have
  // picked is the row at the top.
  const rows: SourceCandidate[] = here
    ? claimsOf(here.place.readings)
        .flatMap((claim) => [
          claim.spokesman,
          ...claim.readings.filter((r) => r !== claim.spokesman),
        ])
        .filter((reading) => reading.hash !== held)
        .map((reading) => ({
          hash: reading.hash,
          source: reading.source,
          text: reading.text,
          confidence: reading.confidence,
          distance: here.apart,
          label: reading.label,
          held: false,
        }))
    : []

  const own = (isHeld: boolean): SourceCandidate => ({
    hash: 'own',
    source: 'own',
    text: isHeld ? object.source.lines.join('\n') : '',
    confidence: null,
    distance: null,
    label: null,
    held: isHeld,
  })

  // Outside the ordering, both of them: a person's own writing has no
  // confidence to rank against a model's, and the held one is not competing in
  // a list it has been picked out of.
  const top: SourceCandidate[] = [own(held === 'own')]
  if (held !== 'own') {
    const standing = pool.find((c) => c.hash === held)
    if (standing) {
      top.push({
        hash: standing.hash,
        source: standing.source,
        // The object's words, not the reading's. They started out the same and
        // the reading is only where they were got — showing the reading here
        // would hide a correction behind the thing it corrected.
        text: object.source.lines.join('\n'),
        confidence: standing.confidence,
        distance: distanceTo(centre, {
          x: standing.x,
          y: standing.y,
          w: standing.w,
          h: standing.h,
        }),
        label: standing.label,
        held: true,
      })
    }
  }
  return [...top, ...rows]
}
