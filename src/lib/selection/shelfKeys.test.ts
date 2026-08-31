import { describe, expect, it } from 'vitest'
import { routeShelfKey, type ShelfKeyModifiers } from './shelfKeys'

function mod(key: string, overrides: Partial<ShelfKeyModifiers> = {}): ShelfKeyModifiers {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides }
}

describe('routeShelfKey', () => {
  it('clears on Escape no matter where the keyboard sits', () => {
    expect(routeShelfKey(mod('Escape'), false)).toEqual({ type: 'clear' })
    expect(routeShelfKey(mod('Escape'), true)).toEqual({ type: 'clear' })
  })

  it('does nothing at all once a workspace row holds focus', () => {
    expect(routeShelfKey(mod('ArrowDown'), true)).toBeNull()
    expect(routeShelfKey(mod('Enter'), true)).toBeNull()
    expect(routeShelfKey(mod('a', { ctrlKey: true }), true)).toBeNull()
  })

  it('selects all in the focused region on Ctrl/Cmd+A', () => {
    expect(routeShelfKey(mod('a', { ctrlKey: true }), false)).toEqual({ type: 'chooseAll' })
    expect(routeShelfKey(mod('A', { metaKey: true }), false)).toEqual({ type: 'chooseAll' })
  })

  it('ignores other modifier combinations', () => {
    expect(routeShelfKey(mod('ArrowDown', { ctrlKey: true }), false)).toBeNull()
    expect(routeShelfKey(mod('ArrowDown', { altKey: true }), false)).toBeNull()
  })

  it('walks the grid on plain arrows, carrying shift as an extend', () => {
    expect(routeShelfKey(mod('ArrowLeft'), false)).toEqual({
      type: 'walk',
      across: -1,
      down: 0,
      extend: false,
    })
    expect(routeShelfKey(mod('ArrowRight'), false)).toEqual({
      type: 'walk',
      across: 1,
      down: 0,
      extend: false,
    })
    expect(routeShelfKey(mod('ArrowUp'), false)).toEqual({
      type: 'walk',
      across: 0,
      down: -1,
      extend: false,
    })
    expect(routeShelfKey(mod('ArrowDown', { shiftKey: true }), false)).toEqual({
      type: 'walk',
      across: 0,
      down: 1,
      extend: true,
    })
  })

  it('activates on Enter', () => {
    expect(routeShelfKey(mod('Enter'), false)).toEqual({ type: 'activate' })
  })

  it('answers nothing for an unrelated key', () => {
    expect(routeShelfKey(mod('x'), false)).toBeNull()
  })
})
