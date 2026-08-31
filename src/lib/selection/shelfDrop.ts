import type { Point } from '@/lib/selection/rect'
import type { CardBox } from '@/lib/selection/shelfMarquee'

/**
 * Where a drop lands among a row-wrapping grid, read off each card's own box
 * rather than the list it came from — the grid's own wrapping is the only
 * thing that knows which card a point reads as standing in front of.
 *
 * `cards` are expected in the order they read. The first one the point has
 * not yet reached — past its row entirely, or short of its own horizontal
 * midpoint within the row it is inside — is where the drop belongs; a point
 * past every card lands at the end.
 */
export function insertionIndexAt(cards: readonly CardBox[], point: Point): number {
  for (let i = 0; i < cards.length; i++) {
    const box = cards[i].box
    if (point.y >= box.y + box.h) continue
    if (point.y < box.y || point.x < box.x + box.w / 2) return i
  }
  return cards.length
}
