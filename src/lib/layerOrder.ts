/** Where the layer order menu sends what is selected among its siblings. */
export type Restack = 'top' | 'up' | 'down' | 'bottom'

export interface RestackItem {
  selected: boolean
  /** Listed in the layer panel; a step up or down passes over the rest. */
  shown: boolean
}

/**
 * The siblings' new order, as indices into `items`, which run bottom to top.
 *
 * Selected items keep their order among themselves. A step moves each one past
 * the next shown sibling that is not itself selected, and an item already
 * against the end, or held under one that is, stays where it is.
 */
export function restackOrder(items: readonly RestackItem[], how: Restack): number[] {
  const order = items.map((_, i) => i)
  const picked = (i: number) => items[i]!.selected
  if (how === 'top') return [...order.filter((i) => !picked(i)), ...order.filter(picked)]
  if (how === 'bottom') return [...order.filter(picked), ...order.filter((i) => !picked(i))]

  const up = how === 'up'
  const at = up ? [...order.keys()].reverse() : [...order.keys()]
  for (const start of at) {
    const i = order[start]!
    if (!picked(i)) continue
    let k = start
    do k += up ? 1 : -1
    while (k >= 0 && k < order.length && !items[order[k]!]!.shown)
    if (k < 0 || k >= order.length || picked(order[k]!)) continue
    order.splice(start, 1)
    order.splice(k, 0, i)
  }
  return order
}
