/**
 * What the page should do about everything that was read on it.
 *
 * ⭐ Taken over the whole pool at once rather than over one run's arrivals. Four
 * readers do not come back together, and asking "what now" as each one lands
 * gives an answer that depends on who finished first — the same page read the
 * same way would come out differently on two machines.
 *
 * ⭐ And taken again on every rerun, even one that brought back nothing new.
 * That is the whole of how an object somebody drew by hand after the first pass
 * gets filled: no reading changed, the question was simply asked again.
 *
 * Nothing here writes anything. It answers two tables — who should stand for
 * what, and where an object should be created — and the caller applies them.
 */
import type { OcrCandidatePersisted, SourceBody } from '../page/types'
import { distanceTo, nearEnough, placesIn, type Place, type Point } from './places'
import { byStrength, claimsOf, type Claim } from './vote'

/**
 * Below this a reading does not go into a slot unless a person puts it there.
 *
 * Measured rather than rounded: on a real page every reading at 0.69 or under
 * was line art read as characters, and 0.72 was a sound effect nothing else had
 * found — the floor sits in that gap. ⚠️ A floor and not a promise: it keeps out
 * the noise, not the mistakes.
 */
export const FILL_FLOOR = 0.7

/**
 * And below this nothing is created out of nothing.
 *
 * ⭐ Higher than the floor above, because the two mistakes cost differently. A
 * wrong fill leaves the object standing where it was and puts the wrong words
 * in it, which is one edit to undo. A wrongly created object is a piece of
 * rubbish somebody has to notice before they can delete it — work made, not
 * work misdirected.
 *
 * Measured on the same page: every reading manga-ocr got right scored 0.97 or
 * better, and the band from 0.8 to 0.9 held two that were wrong. This sits above
 * that band rather than at the top of it, since a floor at 0.97 would create
 * almost nothing.
 */
export const CREATE_FLOOR = 0.95

/** One text object, as far as this decision is concerned. */
export interface Standing {
  id: string
  /** Where it visually sits, not the anchor it is stored by. */
  centre: Point
  source: Pick<SourceBody, 'by' | 'from'>
}

/**
 * What a place turned out to say, and how the artwork set it.
 *
 * ⭐ The words and not a pointer to them. A reading is a measurement of the
 * artwork; what an object says is the object's, and the two stop being the same
 * fact the moment somebody corrects one of them.
 */
export interface Filling extends Typography {
  /** What the winning claim says, line breaks and all. */
  text: string
  /** The reading those words were got from — a birth certificate, no more. */
  from: string
}

/**
 * How one run measured a place to be set.
 *
 * ⚠️ Absent, not defaulted, on a field nothing measured. A default here would
 * let an estimate be read as an observation.
 */
export interface Typography {
  vertical?: boolean
  fontSizePx?: number
  leadingPercent?: number
}

/** An object to create, and everything known about how it should look. */
export interface Born extends Filling {
  centre: Point
}

export interface Verdict {
  /** Object id, and what its source should now say. */
  fills: Map<string, Filling>
  spawns: Born[]
}

export function decide(
  objects: readonly Standing[],
  pool: readonly OcrCandidatePersisted[],
  mayNotCreate: ReadonlySet<string> = new Set(),
): Verdict {
  // ⚠️ Before the places are worked out, not after. A reading somebody has
  // turned down must not shape the place either — it is out of the argument
  // entirely, or clearing a page of noise and pressing the button again would
  // put all of it back up for a vote.
  const heard = placesIn(pool.filter((reading) => !reading.setAside))
    .map((place) => ({ place, top: claimsOf(place.readings)[0] }))
    .filter((one): one is { place: Place; top: Claim } => one.top !== undefined)
    // The strongest place is served first, which is what settles a contest over
    // one object without either side depending on the order the pool is in.
    .sort((a, b) => byStrength(a.top, b.top))

  const fills = new Map<string, Filling>()
  const spawns: Born[] = []
  const taken = new Set<string>()

  for (const { place, top } of heard) {
    const object = nearestFree(objects, place, taken)

    if (object) {
      taken.add(object.id)
      // ⚠️ An object a person answered for is settled, including when they
      // answered "nothing". Nothing automatic writes over that.
      if (object.source.by === 'human') continue
      if (top.confidence < FILL_FLOOR) continue
      // ⭐ Already answered with exactly this. Reporting it anyway would put a
      // step on the undo stack and mark the page for saving, which is what
      // "running it again is free" has to mean beyond the pool not growing.
      if (object.source.from === top.spokesman.hash) continue
      fills.set(object.id, filling(top))
      continue
    }

    // ⭐ Two questions, and they are asked of different things. Whether to
    // create anything is asked of the sources allowed to create; what the new
    // object says is whatever won the vote. Asking only the winner would let one
    // source that may not create take the whole place down with it.
    const founder = place.readings.find(
      (r) => !mayNotCreate.has(r.source) && r.confidence >= CREATE_FLOOR,
    )
    if (!founder) continue

    spawns.push({
      ...filling(top),
      centre: { x: place.x + place.w / 2, y: place.y + place.h / 2 },
    })
  }
  return { fills, spawns }
}

/**
 * ⭐ The nearest object this place could be talking about, unless a stronger
 * place already claimed it. Two balloons side by side both reach for an object
 * between them, and whichever were served second would otherwise overwrite the
 * first by nothing but coincidence.
 *
 * A place that loses its object becomes a place with no object, and is then
 * free to create one — which is the right outcome: something was read there and
 * nothing answers for it.
 */
function nearestFree(
  objects: readonly Standing[],
  place: Place,
  taken: ReadonlySet<string>,
): Standing | null {
  let best: Standing | null = null
  let apart = Infinity
  for (const object of objects) {
    if (taken.has(object.id) || !nearEnough(object.centre, place)) continue
    const d = distanceTo(object.centre, place)
    if (d < apart) {
      apart = d
      best = object
    }
  }
  return best
}

/**
 * What a winning claim comes to: its words, the reading they were got from, and
 * how the artwork set it.
 *
 * The typography is taken from the reading that spoke for the claim — the
 * measurement rides with a reading, so this is a lookup rather than a decision.
 * Absent where the run that read it measured nothing.
 */
function filling(claim: Claim): Filling {
  const { vertical, fontSizePx, leadingPercent } = claim.spokesman
  const out: Filling = { text: claim.text, from: claim.spokesman.hash }
  if (vertical !== undefined) out.vertical = vertical
  if (fontSizePx !== undefined) out.fontSizePx = fontSizePx
  if (leadingPercent !== undefined) out.leadingPercent = leadingPercent
  return out
}
