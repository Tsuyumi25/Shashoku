import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCardStore } from '@/stores/cardStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useCardStore.place', () => {
  /**
   * ⭐ A card is drawn from what is held here, so anything besides the
   * rectangle — the readings it was placed with — would outlive the page
   * moving on, and a dismissal would answer with those instead of today's.
   */
  it('holds a card’s rectangle and none of the plan it was placed from', () => {
    const cards = useCardStore()
    const plan = { x: 1, y: 2, w: 3, h: 4, key: 'k', readings: [{ hash: 'old' }] }
    cards.place('p|source|k', plan)
    expect(cards.boxOf('p|source|k')).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })
})
