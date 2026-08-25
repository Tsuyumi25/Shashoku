import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface CardBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where every card stands, and which one was touched last.
 *
 * ⚠️ Session state, deliberately not saved. A card's position is neither
 * evidence nor content, so opening a save surface for it would be paying a
 * schema for something nobody would miss — and the placement is deterministic,
 * so reopening a project puts every card back where it was.
 *
 * ⭐ Placed once and then left alone. A card whose position was recomputed from
 * the page would wander every time an object was made or a row was taken, and
 * a reader who had just found it would have to find it again. The placement
 * answers where a *new* card goes; a card that already has a box keeps it until
 * somebody moves it themselves.
 *
 * ⭐ And the box is absolute, not an offset from where the placement wanted it.
 * Stored as an offset, a card somebody pinned would jump the moment the
 * placement ran again, which is not what pinning means.
 *
 * ⭐ Not overlapping is the placement's goal, not a rule about the page. A card
 * somebody dragged is unconstrained — over another card, over the artwork,
 * wherever they put it. They can see it, and they meant it.
 */
export const useCardStore = defineStore('cards', () => {
  const boxes = ref(new Map<string, CardBox>())

  /**
   * When each card was last touched, on a counter of this store's own.
   *
   * ⭐ One rule covers the whole of stacking order: touched beats untouched, and
   * between two touched ones the more recent wins. A card picked up is a card
   * being worked on, and a card being worked on belongs on top.
   */
  const touched = ref(new Map<string, number>())
  let clock = 0

  /**
   * Which rows a card has offered at any point this session, in the order they
   * first appeared.
   *
   * ⭐ What keeps a card still as it is worked through: a row that has been
   * taken up leaves its space behind, so the row under the pointer is still
   * under the pointer at the next press.
   *
   * ⚠️ What it has *offered*, not every reading its place holds. A reading the
   * automatic pass already answered for was never on this card, and reserving
   * space for it would open a hole in a card nobody had touched.
   */
  const shown = ref(new Map<string, string[]>())

  function boxOf(key: string): CardBox | undefined {
    return boxes.value.get(key)
  }

  /** Where the placement put a card that had no box yet. */
  function place(key: string, box: CardBox): void {
    const next = new Map(boxes.value)
    next.set(key, box)
    boxes.value = next
  }

  /**
   * Grow a card that has more to show than it had when it was placed — a rerun
   * bringing something new to a place. Downward and rightward from where it
   * stands, so its top does not move.
   */
  function grow(key: string, size: { w: number; h: number }): void {
    const held = boxes.value.get(key)
    if (!held || (size.w <= held.w && size.h <= held.h)) return
    place(key, { ...held, w: Math.max(held.w, size.w), h: Math.max(held.h, size.h) })
  }

  function moveTo(key: string, at: { x: number; y: number }): void {
    const held = boxes.value.get(key)
    if (!held) return
    place(key, { ...held, x: at.x, y: at.y })
    touch(key)
  }

  function touch(key: string): void {
    clock += 1
    const next = new Map(touched.value)
    next.set(key, clock)
    touched.value = next
  }

  function orderOf(key: string): number {
    return touched.value.get(key) ?? 0
  }

  /** Every box standing on one page, for placing a newcomer clear of them. */
  function boxesUnder(prefix: string): CardBox[] {
    const out: CardBox[] = []
    for (const [key, box] of boxes.value) if (key.startsWith(prefix)) out.push(box)
    return out
  }

  function rowsShown(key: string): readonly string[] {
    return shown.value.get(key) ?? []
  }

  /** Note whatever is on offer now, keeping what has been on offer before. */
  function noteShown(key: string, hashes: readonly string[]): void {
    const held = shown.value.get(key) ?? []
    const fresh = hashes.filter((hash) => !held.includes(hash))
    if (fresh.length === 0) return
    const next = new Map(shown.value)
    next.set(key, [...held, ...fresh])
    shown.value = next
  }

  /**
   * Which pages turned out to have no room for their lists, so the lists stand
   * beside the page instead of on it.
   *
   * ⭐ Settled once, when a page's cards are first placed, and then left alone —
   * like the positions themselves. A verdict that could flip as objects were
   * made would move every list on the page at once, which is the one thing a
   * reader in the middle of working through them must not have happen.
   */
  const crowded = ref(new Set<string>())

  function isCrowded(page: string): boolean {
    return crowded.value.has(page)
  }

  function settleCrowding(page: string, tight: boolean): void {
    if (!tight || crowded.value.has(page)) return
    crowded.value = new Set(crowded.value).add(page)
  }

  /** Closing a project ends the session these belong to. */
  function reset(): void {
    boxes.value = new Map()
    touched.value = new Map()
    shown.value = new Map()
    crowded.value = new Set()
    clock = 0
  }

  return {
    boxes,
    touched,
    crowded,
    isCrowded,
    settleCrowding,
    boxOf,
    place,
    grow,
    moveTo,
    touch,
    orderOf,
    boxesUnder,
    rowsShown,
    noteShown,
    reset,
  }
})
