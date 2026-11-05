/**
 * Where an arrow lands among cards in a wrapping grid, read off the boxes on
 * screen rather than off the list. The grid wraps at whatever width its panel
 * happens to be, and may be broken into bands by headings, so the row above is
 * a question only the layout can answer.
 *
 * `from` is the key the cursor is on; the first card when it is on none.
 * Running off an edge stays where it was.
 */
export function gridStep(
  cards: readonly HTMLElement[],
  from: string | null,
  across: number,
  down: number,
): string | null {
  if (cards.length === 0) return null
  const at = cards.findIndex((el) => el.dataset.key === from)
  if (at === -1) return cards[0].dataset.key ?? null
  if (across !== 0) return (cards[at + across] ?? cards[at]).dataset.key ?? null

  const start = cards[at].getBoundingClientRect()
  const middle = start.left + start.width / 2
  let best: HTMLElement | null = null
  let nearest = Infinity
  for (const el of cards) {
    const box = el.getBoundingClientRect()
    const away = down > 0 ? box.top - start.top : start.top - box.top
    if (away <= 1) continue
    const reach = away * 10000 + Math.abs(box.left + box.width / 2 - middle)
    if (reach < nearest) {
      nearest = reach
      best = el
    }
  }
  return best?.dataset.key ?? from
}
