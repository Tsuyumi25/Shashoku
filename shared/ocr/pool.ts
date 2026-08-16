import type { OcrCandidatePersisted } from '../page/types'
import { ocrIdentity, type OcrBirth } from './identity'

/**
 * A reading as it arrives from a recognizer, before it has an identity.
 *
 * `label` is carried but takes no part in the identity: it describes the region
 * the reading came out of rather than the reading, and two arrivals that agree
 * on everything else are the same reading whatever the region was called.
 */
export interface OcrArrival extends OcrBirth {
  label: string
}

export interface Absorbed {
  candidates: OcrCandidatePersisted[]
  /** The identities that were not already there. */
  born: string[]
}

/**
 * Takes a run's readings into a page's pool.
 *
 * ⭐ An arrival that is already in the pool is left completely alone — not
 * refreshed, not re-dated, not rewritten. That is the whole reason identities
 * exist: running the same model over the same page a second time then changes
 * nothing at all, including any correction someone typed into a reading in
 * between. Rerunning is free, and free means it costs no work.
 *
 * New arrivals are appended rather than sorted in. Order in this file carries
 * nothing — what a reader sees is sorted by where they are standing and how
 * sure each reading was — and appending keeps a rerun from rewriting every line
 * of a file that gained one entry.
 */
export function absorb(
  pool: readonly OcrCandidatePersisted[],
  arrivals: readonly OcrArrival[],
): Absorbed {
  const known = new Set(pool.map((c) => c.hash))
  const candidates = [...pool]
  const born: string[] = []

  for (const arrival of arrivals) {
    const hash = ocrIdentity(arrival)
    // Two arrivals in one run can carry the same identity — the same model can
    // read two identical boxes off a page of repeated panels. The first wins
    // and the second is the same reading, not a second one.
    if (known.has(hash)) continue
    known.add(hash)
    born.push(hash)
    candidates.push({
      hash,
      source: arrival.source,
      text: arrival.text,
      original: arrival.text,
      x: arrival.x,
      y: arrival.y,
      w: arrival.width,
      h: arrival.height,
      confidence: arrival.confidence,
      label: arrival.label,
    })
  }
  return { candidates, born }
}
