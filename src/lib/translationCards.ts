/**
 * Where each object's translation candidates stand: the margin the canvas shows
 * all round the page.
 *
 * ⭐ Off the document, unlike the readings' lists, which stand on the artwork
 * they were read from. A reading is a claim about a particular patch of drawing
 * and has to be judged against it; a candidate is judged against the source and
 * against the other candidates, and none of that is anywhere on the artwork. A
 * card lying over the page would be covering the one thing it is not about.
 *
 * That leaves which list belongs to which object to be drawn rather than shown
 * by proximity, which is what the connector is for — and why it is drawn only
 * for the object being pointed at or selected. Every list showing every line at
 * once is the picture this placement exists to make readable.
 *
 * Page pixels throughout, for the same reason as the readings' lists: a card
 * sized in screen pixels changes its relationship to the page at every zoom.
 */
import type { Box } from '@shared/ocr/places'
import type { TranslationBody } from '@shared/page/types'
import { cardGap, cardSize } from './sourceCards'

/** The row that is the object's own typed lines rather than anybody's proposal. */
export const OWN = 'own'

export interface TranslationRow {
  /** A candidate's id, or `OWN`. */
  id: string
  text: string
  /** Whose words these are — a proposal, a correction, or the object's own. */
  by: 'own' | 'human' | 'model'
  /** Which model proposed it, when one did. */
  source?: string
}

export interface TranslationList {
  objectId: string
  rows: readonly TranslationRow[]
  /** Which row the object currently reads as. */
  chosen: string
  /** The object's own frame, for drawing the connector back to it. */
  from: Box
}

export interface TranslationCard extends TranslationList, Box {
  key: string
}

/**
 * Every line an object can be read as, the one it is reading among them.
 *
 * ⚠️ The object's own lines are a row like the others, and they are here even
 * when a proposal is picked, as long as there is something in them. They are
 * what deleting the picked proposal drops the object back to — a row that
 * vanished the moment something was picked would make that fall look like the
 * words appearing from nowhere.
 *
 * They are also here when nothing is picked and they are empty, because that is
 * the row the object is reading: a list whose current line was missing from it
 * would be a list with no way back to where you started.
 */
export function rowsOf(body: TranslationBody): TranslationRow[] {
  const own = body.lines.join('')
  const rows: TranslationRow[] = []
  if (own.length > 0 || body.chosen === null) {
    rows.push({ id: OWN, text: body.lines.join('\n'), by: 'own' })
  }
  for (const candidate of body.candidates) {
    rows.push({
      id: candidate.id,
      text: candidate.lines.join('\n'),
      by: candidate.human === true ? 'human' : 'model',
      ...(candidate.source === undefined ? {} : { source: candidate.source }),
    })
  }
  return rows
}

/**
 * ⭐ Two rows before there is a card, the picked one counted. One row is not a
 * choice: the object already reads as it, and typing into the object types into
 * that very row — so a card would be a second place to do the one thing left to
 * do, and every object on the page would have one.
 */
export function offersAChoice(rows: readonly TranslationRow[]): boolean {
  return rows.length >= 2
}

interface Point {
  x: number
  y: number
}

function middleOf(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

function apart(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * How far along a margin a card may be pushed before some other margin would be
 * nearer anyway — a bound on the search, not on where a card may end up.
 */
const SLIDES = 12

/**
 * Every spot a card of this size may stand in, clear of the page.
 *
 * ⭐ A fixed set of spots rather than a search over the whole margin. Four
 * margins, each with the card level with the object it belongs to, and that spot
 * then slid along the margin both ways a card at a time — so the sequence
 * exhausts a margin instead of crowding one point on it, and the same page comes
 * out the same way twice.
 */
function spotsFor(
  from: Box,
  size: { w: number; h: number },
  page: { width: number; height: number },
  gap: number,
): Box[] {
  const at = middleOf(from)
  const margins = [
    { x: page.width + gap, y: at.y - size.h / 2, along: 'y' as const },
    { x: -size.w - gap, y: at.y - size.h / 2, along: 'y' as const },
    { x: at.x - size.w / 2, y: page.height + gap, along: 'x' as const },
    { x: at.x - size.w / 2, y: -size.h - gap, along: 'x' as const },
  ]
  const out: Box[] = []
  for (const margin of margins) {
    const step = (margin.along === 'y' ? size.h : size.w) + gap
    for (let k = 0; k <= SLIDES; k += 1) {
      for (const way of k === 0 ? [0] : [1, -1]) {
        const shift = k * way * step
        out.push({
          x: margin.x + (margin.along === 'x' ? shift : 0),
          y: margin.y + (margin.along === 'y' ? shift : 0),
          ...size,
        })
      }
    }
  }
  return out
}

/** How big a card holding these rows comes out. */
export function translationCardSize(
  rows: readonly TranslationRow[],
  basePx: number,
): { w: number; h: number } {
  return cardSize(
    rows.map((r) => r.text),
    basePx,
  )
}

/**
 * Every list, placed.
 *
 * ⭐ The nearest free spot off the page, measured straight from the object.
 * Which list belongs to which object is said by the connector, so what the
 * placement owes a reader is the shortest line it can manage — a card across the
 * page from its object drags that line over the artwork.
 *
 * Two lists never share a spot: one already taken is skipped for the next
 * nearest, which spreads a crowded page along the margins rather than piling it
 * into a corner. `taken` is what is already standing, so a list placed later
 * gives way to one a reader has already found rather than the other way round.
 *
 * ⚠️ Greedy, and in the objects' own order top to bottom. Not the tightest
 * packing there is, but the same page plans the same way twice and a candidate
 * added to the last list cannot rearrange the first.
 */
export function planTranslations(
  lists: readonly TranslationList[],
  basePx: number,
  page: { width: number; height: number },
  taken: readonly Box[] = [],
): TranslationCard[] {
  const gap = cardGap(basePx) * 2
  const ordered = [...lists].sort((a, b) => a.from.y - b.from.y || a.from.x - b.from.x)
  const placed: Box[] = [...taken]
  const out: TranslationCard[] = []
  for (const list of ordered) {
    const size = translationCardSize(list.rows, basePx)
    const at = middleOf(list.from)
    const spots = spotsFor(list.from, size, page, gap).sort(
      (a, b) => apart(at, middleOf(a)) - apart(at, middleOf(b)),
    )
    // Nothing is ever dropped for want of room: with every spot taken the
    // nearest is used anyway, since a list somewhere awkward can be dragged and
    // a list that was never drawn cannot be found.
    const spot = spots.find((s) => !placed.some((p) => overlaps(p, s))) ?? spots[0]
    placed.push(spot)
    out.push({ ...list, key: list.objectId, ...spot })
  }
  return out
}

/**
 * Where a line leaves a box on its way to a point: the boundary, not the middle.
 *
 * A card can stand off any of the four margins, so which edge that is is worked
 * out rather than chosen — a line drawn from a fixed side would run back across
 * its own card for half the page.
 */
export function edgeToward(box: Box, toward: Point): Point {
  const at = middleOf(box)
  const dx = toward.x - at.x
  const dy = toward.y - at.y
  if (dx === 0 && dy === 0) return at
  const reach = Math.min(
    dx === 0 ? Infinity : box.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.h / 2 / Math.abs(dy),
  )
  return { x: at.x + dx * reach, y: at.y + dy * reach }
}

/** The connector, between the facing edges of an object and its list. */
export function tetherBetween(from: Box, card: Box): { a: Point; b: Point } {
  return { a: edgeToward(from, middleOf(card)), b: edgeToward(card, middleOf(from)) }
}
