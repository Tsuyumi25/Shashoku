/**
 * The candidates: what was read near this text object, arranged for it.
 * Recomputed on every ask and never stored — move the object and the list is
 * a different list.
 *
 * ⚠️ Near is a filter and not only a sort, and it is two questions.
 * `CANDIDATE_RANGE` asks whether the object is placed like it belongs to that
 * box, in units of the box; `CANDIDATE_SPAN` asks whether the gap is long by
 * the standards of the page. Neither answers the other; a reading must pass
 * both.
 */
import type { OcrCandidatePersisted, TextSource } from '../page/types'

export interface Point {
  x: number
  y: number
}

/**
 * One candidate for this object's source.
 *
 * The object's own written source appears here too, as the entry whose `hash`
 * is `own` — a candidate like any other, but with no confidence and no place
 * on the page, because a person wrote it.
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

/** How many distinct places on the page the list reaches, at most. */
export const CANDIDATE_REACH = 8

/**
 * How far the list reaches, as a multiple of what `nearEnough` calls near —
 * ⭐ wider than the pairing rule on purpose, because the list exists to fix
 * what pairing got wrong.
 *
 * Measured over a hundred and fourteen regions of five pages, in this same
 * unit: the nearest other region sits at 0.8, the second at 1.6, the third at
 * 2.5. That reaches the two or three regions somebody might have meant and
 * drops about two thirds of what a count of eight alone let through — the
 * eighth nearest is typically five times out.
 */
export const CANDIDATE_RANGE = 2.5

/**
 * The other half of near, as a share of the page's own diagonal.
 *
 * ⭐ The two tests come apart on a wide caption: its circle is wide because
 * *it* is wide, so `CANDIDATE_RANGE` admits a balloon half a page off.
 * Measured over five pages, a box of radius 250 or more admits readings four
 * and a half times further across the page than a small one, out to nearly
 * half the diagonal.
 *
 * Measured from the box's edge, not its middle, so it cannot undo the first
 * rule — an object inside a page-spanning caption has a gap of zero. And a
 * brake on large boxes only, by construction: a small box admits at most
 * 0.062 of the diagonal, which never reaches 0.075.
 */
export const CANDIDATE_SPAN = 0.075

/**
 * What the list shows for one object.
 *
 * `centre` is where the object visually sits, not the anchor it is stored by —
 * the anchor means a different corner depending on how the text is aligned.
 *
 * ⚠️ The reading in the slot comes first and is exempt from the near test and
 * the count: an object carried across the page still stands for what somebody
 * said it stands for, and a list that dropped it would report the choice as
 * unmade.
 */
export function candidatesFor(
  object: { source: TextSource; ownSource: string },
  centre: Point,
  pool: readonly OcrCandidatePersisted[],
  page: { width: number; height: number },
  reach: number = CANDIDATE_REACH,
): SourceCandidate[] {
  const held = object.source.hash
  const offered = pool.filter((c) => c.hash !== held)

  // Grouped by where it was read before being counted: counting rows instead
  // would halve the reach for asking a second opinion.
  const places = new Map<string, OcrCandidatePersisted[]>()
  for (const candidate of offered) {
    const at = `${candidate.x},${candidate.y},${candidate.w},${candidate.h}`
    const already = places.get(at)
    if (already) already.push(candidate)
    else places.set(at, [candidate])
  }

  const span = Math.hypot(page.width, page.height) * CANDIDATE_SPAN
  const near = [...places.values()]
    .filter(
      (group) =>
        nearEnough(centre, group[0], CANDIDATE_RANGE) && gapTo(centre, group[0]) <= span,
    )
    .map((group) => ({ group, distance: distanceTo(centre, group[0]) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, reach)

  const rows: SourceCandidate[] = near
    .flatMap(({ group, distance }) =>
      group.map((c) => ({
        hash: c.hash,
        source: c.source,
        text: c.text,
        confidence: c.confidence,
        distance,
        label: c.label,
        held: false,
      })),
    )
    .sort(byNearestThenSurest)

  const own = (isHeld: boolean): SourceCandidate => ({
    hash: 'own',
    source: 'own',
    text: object.ownSource,
    confidence: null,
    distance: null,
    label: null,
    held: isHeld,
  })

  // Outside the sort, both of them: a person's own writing has no confidence
  // to rank against a model's, and the held one is not competing in a list it
  // has been picked out of.
  const top: SourceCandidate[] = []
  if (held === 'own') top.push(own(true))
  else {
    const standing = held === null ? undefined : pool.find((c) => c.hash === held)
    if (standing) {
      top.push({
        hash: standing.hash,
        source: standing.source,
        text: standing.text,
        confidence: standing.confidence,
        distance: distanceTo(centre, standing),
        label: standing.label,
        held: true,
      })
    }
    // Empty is not a row — the button that makes one is the whole offer.
    if (object.ownSource.length > 0) top.push(own(false))
  }
  return [...top, ...rows]
}

/**
 * Nearest first; among readings of one box, the surest first. The two keys
 * are never traded off — confidence only answers which of two readings of the
 * *same* box to offer first.
 */
export function byNearestThenSurest(a: SourceCandidate, b: SourceCandidate): number {
  const apart = (a.distance ?? 0) - (b.distance ?? 0)
  return apart !== 0 ? apart : (b.confidence ?? 0) - (a.confidence ?? 0)
}

/**
 * Below this a reading is not put in a slot unless a person puts it there.
 * Measured rather than rounded: on a real page every reading at 0.69 or under
 * was line art read as characters, and 0.72 was a sound effect nothing else
 * had found — the floor sits in that gap. ⚠️ A floor and not a promise: it
 * keeps out the noise, not the mistakes.
 */
export const SETTLE_FLOOR = 0.7

/**
 * Near enough means inside the circle that just contains the reading's box —
 * scale-free where a pixel threshold is not (pages here run from eighteen
 * hundred across to five thousand), and slightly wider than the box on
 * purpose: the box hugs the ink, and somebody placing an object in a balloon
 * aims at the balloon.
 */
export function nearEnough(
  centre: Point,
  box: { x: number; y: number; w: number; h: number },
  times = 1,
): boolean {
  return distanceTo(centre, box) <= (Math.hypot(box.w, box.h) / 2) * times
}

/**
 * The other half of settling: a run offers its readings to the objects
 * already there, and this offers what is already there to an object as it
 * arrives — same two conditions either way, so which happened first never
 * decides what an object ends up standing for.
 */
export function sourceForNewObject(
  centre: Point,
  pool: readonly OcrCandidatePersisted[],
): TextSource {
  let best: OcrCandidatePersisted | null = null
  let apart = Infinity
  for (const reading of pool) {
    if (reading.confidence < SETTLE_FLOOR || !nearEnough(centre, reading)) continue
    const d = distanceTo(centre, reading)
    // Readings of one box tie exactly, so the surer of them takes it.
    if (d < apart || (d === apart && best !== null && reading.confidence > best.confidence)) {
      apart = d
      best = reading
    }
  }
  return { hash: best?.hash ?? null, by: 'auto' }
}

/** Centre to centre. A text object has no frame of its own to compare edges with. */
function distanceTo(centre: Point, box: { x: number; y: number; w: number; h: number }): number {
  const dx = centre.x - (box.x + box.w / 2)
  const dy = centre.y - (box.y + box.h / 2)
  return Math.hypot(dx, dy)
}

/**
 * The empty space between a point and a box — zero anywhere inside it, which
 * is what stays honest on a wide caption whose middle is far from a point
 * standing on one end of it.
 */
function gapTo(centre: Point, box: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(box.x - centre.x, 0, centre.x - (box.x + box.w))
  const dy = Math.max(box.y - centre.y, 0, centre.y - (box.y + box.h))
  return Math.hypot(dx, dy)
}

/** One text object, as far as settling readings onto it is concerned. */
export interface Settleable {
  id: string
  centre: Point
  source: TextSource
  /** How sure the recognizer was of what is in the slot now, if anything. */
  heldConfidence: number | null
}

/**
 * Where a run's new readings come to rest.
 *
 * ⭐ Driven from the readings, not from the objects: asking each object for
 * its nearest reading lets four objects around one balloon all claim the same
 * sentence, while a reading has one nearest object and goes there or nowhere.
 * No falling through to the second nearest — that would put a sentence on an
 * object it was not read anywhere near, which is worse than an empty slot.
 *
 * Only readings this run brought into being are offered, which is what makes
 * running the same model twice a no-op — including for a slot somebody
 * emptied on purpose, which must not be handed its reading back.
 */
export function settleReadings(
  objects: readonly Settleable[],
  born: readonly OcrCandidatePersisted[],
): Map<string, TextSource> {
  const claims = new Map<string, { reading: OcrCandidatePersisted; distance: number }>()

  for (const reading of born) {
    if (reading.confidence < SETTLE_FLOOR) continue
    let nearest: Settleable | null = null
    let apart = Infinity
    for (const object of objects) {
      const d = distanceTo(object.centre, reading)
      if (d < apart) {
        apart = d
        nearest = object
      }
    }
    // Nearest is not enough — the nearest object can still be halfway across
    // the page.
    if (!nearest || !nearEnough(nearest.centre, reading)) continue

    // Among the readings that landed on one object, the nearest wins; readings
    // of one box tie exactly, so the surer of the two takes it.
    const standing = claims.get(nearest.id)
    const better =
      standing === undefined ||
      apart < standing.distance ||
      (apart === standing.distance && reading.confidence > standing.reading.confidence)
    if (better) claims.set(nearest.id, { reading, distance: apart })
  }

  const settled = new Map<string, TextSource>()
  for (const object of objects) {
    const claim = claims.get(object.id)
    if (!claim) continue
    // A person has answered for this slot, including by answering "nothing".
    if (object.source.by === 'human') continue
    // A slot a previous run filled is only taken over by something surer of
    // itself — never by something merely as sure, or two recognizers that tie
    // would swap it back and forth depending on which ran last.
    if (object.source.hash !== null && claim.reading.confidence <= (object.heldConfidence ?? 0))
      continue
    settled.set(object.id, { hash: claim.reading.hash, by: 'auto' })
  }
  return settled
}
