/**
 * Where each place's list of readings goes, in the page's own pixels.
 *
 * ⭐ Page pixels and not screen pixels, for both the size and the position. A
 * list sized in screen pixels is a list whose relationship to the artwork
 * changes with the zoom: readable and clear at one scale, a solid mat of
 * overlapping cards at another, and never the same picture twice. Sized in page
 * pixels it stands in a fixed relation to the balloon it came off — which is
 * also the relation the reader is being asked to judge.
 *
 * ⚠️ Placed rather than anchored. A list is opaque and the artwork under it is
 * the evidence, so a list that lands on a place hides the very thing its
 * readings were taken from. Every box small enough to be hidden by one is an
 * obstacle here, including the lists already placed.
 */
import type { Box } from '@shared/ocr/places'
import type { OcrCandidatePersisted } from '@shared/page/types'

/**
 * A place's list as it is to be drawn, and as it was before anything left it.
 *
 * ⭐ The card is sized against `full` and draws `readings`, which is what keeps
 * it still. Sized against what is left, a list would shrink every time somebody
 * took a row out of it — and since the placement centres a card beside its
 * place, shrinking moves the top: the rows slide out from under the pointer
 * between one press and the next, which is exactly when a reader is working
 * through a list a row at a time.
 *
 * The reserved height is never given back, which costs nothing: the card covers
 * no more artwork than it did when it was full.
 */
export interface Listed extends Box {
  full: readonly OcrCandidatePersisted[]
  readings: readonly OcrCandidatePersisted[]
}

export interface CardPlan extends Box {
  key: string
  /**
   * Everything the place has ever offered, in order, so the card can hold a
   * taken row's space open. ⚠️ A row that closed up behind the one taken would
   * slide the next row under the pointer between two presses.
   */
  full: readonly OcrCandidatePersisted[]
  /** Which of them are still to be judged. */
  readings: readonly OcrCandidatePersisted[]
  /** The place it came off, for saying which artwork it is about. */
  from: Box
}

/**
 * The type a list is set in, as a share of the page's short side.
 *
 * ⭐ Taken from the page rather than from the project's seed style. What a list
 * has to hold its own against is the artwork it lies on, and pages here run
 * from eighteen hundred pixels across to five thousand — a fixed number would
 * be a caption on one and a headline on the next.
 *
 * About half the size of the type in the balloons, which quarters the area a
 * list takes: that is the difference between a page holding a dozen of them at
 * once and a page where they are all in each other's way. Small enough to read
 * is the requirement, not large enough to compete with the artwork — the
 * artwork is what is being read *from*.
 *
 * ⚠️ Not the seed style, which is what the *translation* is set in and free to
 * be anything: a chapter typeset small would shrink the lists that exist to be
 * read while deciding what that translation should say.
 */
export const TYPE_SHARE = 1 / 90

export function typeSizeFor(page: { width: number; height: number }): number {
  return Math.min(page.width, page.height) * TYPE_SHARE
}

/** How the card's parts measure against that type, unitless. */
const LINE_HEIGHT = 1.5
const PADDING = 0.35
const GAP = 0.5
/** Room for the score that sits at the end of a row. */
const MARK_WIDTH = 1.6
/** The line the reader's name takes, under the text it belongs to. */
const NAME_LINE = 0.95
/** And the row of buttons under the whole list. */
const FOOT_LINE = 1.8
/** What the text column may narrow and widen to, the score not counted. */
const MIN_TEXT = 4
const MAX_TEXT = 14

/** What a reading with nothing in it reads as, here and in the card itself. */
export const EMPTY_READING = '（空）'

/** The clearance a card keeps from whatever it is placed beside. */
export function cardGap(basePx: number): number {
  return basePx * GAP
}

/**
 * How wide a run of text comes out, in multiples of the type size.
 *
 * Full-width for anything outside Latin, which is what the pages here are made
 * of, and about half that for the rest. Deliberately an estimate: the exact
 * answer needs the typesetter, and a card whose width is off by a character is
 * a card in very slightly the wrong place, while asking the engine to measure
 * every reading on every frame of a zoom is a card that arrives late.
 */
function textWidth(text: string): number {
  let width = 0
  for (const ch of text) width += ch.charCodeAt(0) < 0x2e80 ? 0.55 : 1
  return width
}

/**
 * How wide each of a reading's own lines comes out.
 *
 * A reading arrives already broken where the run measured the balloon's
 * columns, and those breaks are a reader's best clue to which candidate is the
 * one they want. The card keeps them.
 */
function runsOf(text: string): number[] {
  return (text || EMPTY_READING).split('\n').map(textWidth)
}

export function textsOf(readings: readonly OcrCandidatePersisted[]): string[] {
  return readings.map((r) => r.text)
}

/**
 * How big a card has to be to show its rows whole.
 *
 * ⭐ Whole, and not a clipped first line. Two candidates for one balloon differ
 * by a character or two far more often than they differ in their opening, so a
 * row cut off at the card's edge hides exactly the part being judged.
 *
 * The column is as wide as the widest line it has to hold, within bounds, and
 * anything longer wraps — so the height counts wrapped lines rather than
 * readings.
 *
 * ⚠️ The card wraps at this same column, and the two have to keep agreeing.
 * Getting the count wrong clips nothing; it hands `planCards` a card the wrong
 * size to place, and the lists come out over each other.
 */
export function cardSize(
  texts: readonly string[],
  basePx: number,
): { w: number; h: number } {
  const runs = texts.map(runsOf)
  const widest = runs.length === 0 ? MIN_TEXT : Math.max(...runs.flat())
  const column = Math.min(Math.max(widest, MIN_TEXT), MAX_TEXT)
  const lines = runs.reduce(
    (sum, run) => sum + run.reduce((n, width) => n + Math.max(1, Math.ceil(width / column)), 0),
    0,
  )
  return {
    w: (column + MARK_WIDTH + PADDING * 2) * basePx,
    h: (lines * LINE_HEIGHT + texts.length * NAME_LINE + FOOT_LINE + PADDING * 2) * basePx,
  }
}

/**
 * How much of the page a box has to cover before a list may sit on it.
 *
 * ⭐ A box this size is not something a list can hide — a card lands on a
 * corner of it and the rest is still there to read. What it is instead is a box
 * with no clear ground anywhere near it, and refusing to cover one would leave
 * its own list nowhere to go but further and further from the place it belongs
 * to. A small box is the opposite on both counts: a card covers the whole of
 * it, and there is ordinarily somewhere else to stand.
 */
export const COVERABLE_SHARE = 0.1

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** How much of the card hangs off the page, which is as bad as covering a box. */
function spilled(card: Box, page: { width: number; height: number }): number {
  const inside = overlap(card, { x: 0, y: 0, w: page.width, h: page.height })
  return card.w * card.h - inside
}

/**
 * The four sides, in the order a reader's eye takes them.
 *
 * Right first because these pages are read right to left, so the space beside a
 * balloon on that side is the space the next balloon has already been read out
 * of. Above last: a balloon's tail hangs below it far more often than above,
 * and what is above is usually the panel it belongs to.
 */
function sidesFor(place: Box, size: { w: number; h: number }, gap: number): Box[] {
  const middleY = place.y + place.h / 2 - size.h / 2
  const middleX = place.x + place.w / 2 - size.w / 2
  return [
    { x: place.x + place.w + gap, y: middleY, ...size },
    { x: place.x - size.w - gap, y: middleY, ...size },
    { x: middleX, y: place.y + place.h + gap, ...size },
    { x: middleX, y: place.y - size.h - gap, ...size },
  ]
}

/**
 * Slide a box along one axis until nothing standing is under it.
 *
 * ⭐ One axis, and the one that keeps it near where it wanted to be. A card put
 * outside the page belongs beside its own balloon, so what it may give up is
 * its place in the queue along that edge — never its distance from the artwork
 * it is about.
 */
export function slideClear(
  box: Box,
  standing: readonly Box[],
  axis: 'x' | 'y',
  gap: number,
): Box {
  const out = { ...box }
  const span = axis === 'x' ? 'w' : 'h'
  // Bounded rather than looped to exhaustion: a page cannot hold more cards
  // than it has places, and a runaway here would be a frozen window.
  for (let guard = 0; guard < standing.length + 1; guard += 1) {
    const hit = standing.find((b) => overlap(out, b) > 0)
    if (!hit) break
    out[axis] = hit[axis] + hit[span] + gap
  }
  return out
}

/**
 * Every list, standing just off the page rather than on it.
 *
 * ⭐ For the page that has no room — see `crowding`. Each list keeps its own
 * balloon: it goes out through the nearest edge, level with the place it came
 * off, so the artwork is wholly uncovered and the list is still where the eye
 * would look for it. Poured into one column instead they would all be equally
 * far from everything, which is the same as being nowhere.
 *
 * ⚠️ Not a dismissal. These are lists still waiting to be judged, and what put
 * them here is the page having no room, not anything anybody decided about
 * them — a dismissed list is not drawn at all.
 */
export function outsideCards(
  places: readonly Listed[],
  basePx: number,
  page: { width: number; height: number },
): CardPlan[] {
  const gap = basePx * GAP
  const ordered = [...places].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: Box[] = []
  const out: CardPlan[] = []
  for (const place of ordered) {
    const size = cardSize(textsOf(place.full), basePx)
    const at = standOff(justOutside(place, size, gap, page), nearestEdge(place, page), placed, gap, page)
    placed.push(at)
    out.push({
      key: keyOf(place),
      full: place.full,
      readings: place.readings,
      from: { x: place.x, y: place.y, w: place.w, h: place.h },
      ...at,
    })
  }
  return out
}

/**
 * A spot outside the page that nothing else has, as near as giving way allows.
 *
 * It gives way along the edge first, and only starts a fresh lane further out
 * when it has slid past the end of the page. ⚠️ A single lane is what a busy
 * edge turns into otherwise: eleven lists down one side of a page came to twice
 * its height, which is a scroll rather than a view — where the same lists in
 * three lanes are a block beside the artwork that fits on screen with it.
 */
function standOff(
  box: Box,
  side: Side,
  placed: readonly Box[],
  gap: number,
  page: { width: number; height: number },
): Box {
  const along: 'x' | 'y' = side === 'left' || side === 'right' ? 'y' : 'x'
  const span = along === 'x' ? 'w' : 'h'
  const limit = along === 'x' ? page.width : page.height
  let at = box
  // One lane per card at worst, which is what a page of cards taller than
  // itself would need.
  for (let lane = 0; lane <= placed.length; lane += 1) {
    at = slideClear(at, placed, along, gap)
    if (at[along] + at[span] <= limit || placed.length === 0) break
    at = { ...at, ...nextLane(at, side, placed, gap), [along]: 0 }
  }
  return at
}

/**
 * One lane further from the page, clear of everything already outside it.
 *
 * Past all of them rather than past the ones in this lane: a lane as wide as
 * the widest card wastes a little room and cannot leave two cards on top of
 * each other, which is the one thing being outside has to buy.
 */
function nextLane(
  box: Box,
  side: Side,
  placed: readonly Box[],
  gap: number,
): { x: number } | { y: number } {
  switch (side) {
    case 'left':
      return { x: Math.min(...placed.map((b) => b.x)) - gap - box.w }
    case 'right':
      return { x: Math.max(...placed.map((b) => b.x + b.w)) + gap }
    case 'top':
      return { y: Math.min(...placed.map((b) => b.y)) - gap - box.h }
    default:
      return { y: Math.max(...placed.map((b) => b.y + b.h)) + gap }
  }
}

/** Which way out of the page is shortest from here. */
function nearestEdge(place: Box, page: { width: number; height: number }): Side {
  const cx = place.x + place.w / 2
  const cy = place.y + place.h / 2
  const away: [Side, number][] = [
    ['left', cx],
    ['right', page.width - cx],
    ['top', cy],
    ['bottom', page.height - cy],
  ]
  // Ties settled by the order above, so the same page comes out the same way.
  return away.reduce((best, one) => (one[1] < best[1] ? one : best))[0]
}

type Side = 'left' | 'right' | 'top' | 'bottom'

/** Out through that edge, level with the place it came off. */
function justOutside(
  place: Box,
  size: { w: number; h: number },
  gap: number,
  page: { width: number; height: number },
): Box {
  const cx = place.x + place.w / 2
  const cy = place.y + place.h / 2
  switch (nearestEdge(place, page)) {
    case 'left':
      return { x: -gap - size.w, y: cy - size.h / 2, ...size }
    case 'right':
      return { x: page.width + gap, y: cy - size.h / 2, ...size }
    case 'top':
      return { x: cx - size.w / 2, y: -gap - size.h, ...size }
    default:
      return { x: cx - size.w / 2, y: page.height + gap, ...size }
  }
}

/**
 * How much of the cards' own area the placement had to spend covering things it
 * should not have.
 *
 * ⭐ The honest measure of whether a page has room for its lists, and better
 * than counting them: what matters is not how many there are but whether there
 * was anywhere to stand. It falls out of the placement, which already pays this
 * cost card by card — this only reads the bill.
 */
export function crowding(
  cards: readonly Box[],
  obstacles: readonly Box[],
  page: { width: number; height: number },
): number {
  const area = cards.reduce((sum, card) => sum + card.w * card.h, 0)
  if (area === 0) return 0
  const blocking = obstacles.filter(
    (box) => box.w * box.h < page.width * page.height * COVERABLE_SHARE,
  )
  let spent = 0
  cards.forEach((card, at) => {
    spent += blocking.reduce((sum, box) => sum + overlap(card, box), 0)
    spent += cards.slice(0, at).reduce((sum, box) => sum + overlap(card, box), 0)
    spent += spilled(card, page)
  })
  return spent / area
}

/**
 * Over this the lists belong beside the page rather than on it.
 *
 * ⭐ A card is opaque and the artwork under it is the evidence, so a page whose
 * lists cover this much of their own area in artwork is a page nobody can read
 * either half of. Standing them all outside costs a pan and gives back the
 * whole page — and on a page of hand-drawn lettering, which is where this
 * happens, the artwork is exactly what somebody is reading the candidates
 * against.
 *
 * ⚠️ Descriptive rather than measured, like `SAME_PLACE`. One real page came out
 * at 0.51 with every reader guessing at every balloon, and a page with room to
 * spare comes out near zero; this sits between them. If the wrong pages start
 * going outside, this is the number to look at.
 */
export const CROWDED = 0.25

/**
 * The name a card answers to, which is the place it is about.
 *
 * ⚠️ Carries the place's rectangle, which is stable today by luck rather than
 * by design: every reading of one region shares a box, and the deduplication
 * before a run keeps most regions from merging. If a third thing is ever keyed
 * on this, come back and look at it.
 */
export function keyOf(place: Box): string {
  return `${place.x},${place.y},${place.w},${place.h}`
}

/**
 * Every list, placed.
 *
 * `obstacles` is what must not be covered — every place on the page and every
 * object on it, whether or not it has a list of its own. A place whose readings
 * have all been taken has no list and is still evidence.
 *
 * Nothing is ever dropped for want of room: when every side is blocked the
 * least-blocked one is taken, because a list somewhere awkward can be dragged
 * and a list that was never drawn cannot be found.
 */
export function planCards(
  places: readonly Listed[],
  obstacles: readonly Box[],
  basePx: number,
  page: { width: number; height: number },
): CardPlan[] {
  const gap = basePx * GAP
  const coverable = page.width * page.height * COVERABLE_SHARE
  const blocking = obstacles.filter((box) => box.w * box.h < coverable)
  const placed: Box[] = []
  const out: CardPlan[] = []

  // Top to bottom, so the same page plans the same way twice — the order the
  // pool happens to be in is not something a reader should be able to see. And
  // greedily, so a card arriving cannot move one already placed above it.
  const ordered = [...places].sort((a, b) => a.y - b.y || a.x - b.x)

  for (const place of ordered) {
    const size = cardSize(textsOf(place.full), basePx)
    let best: Box | null = null
    let bestCost = Infinity
    for (const side of sidesFor(place, size, gap)) {
      const cost =
        blocking.reduce((sum, box) => sum + overlap(side, box), 0) +
        placed.reduce((sum, box) => sum + overlap(side, box), 0) +
        spilled(side, page)
      if (cost < bestCost) {
        bestCost = cost
        best = side
      }
      if (cost === 0) break
    }
    if (!best) continue
    placed.push(best)
    out.push({
      key: keyOf(place),
      full: place.full,
      readings: place.readings,
      from: { x: place.x, y: place.y, w: place.w, h: place.h },
      ...best,
    })
  }
  return out
}
