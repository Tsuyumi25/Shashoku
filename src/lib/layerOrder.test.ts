import { describe, expect, it } from 'vitest'
import { restackOrder, type RestackItem } from './layerOrder'

/** Letters bottom to top; upper case is selected, `.` is a sibling the panel does not list. */
function items(spec: string): RestackItem[] {
  return [...spec].map((c) => ({ selected: c !== '.' && c === c.toUpperCase(), shown: c !== '.' }))
}
const apply = (spec: string, how: Parameters<typeof restackOrder>[1]) =>
  restackOrder(items(spec), how)
    .map((i) => spec[i])
    .join('')

describe('restackOrder', () => {
  it('sends the selection to either end in its own order', () => {
    expect(apply('aBcDe', 'top')).toBe('aceBD')
    expect(apply('aBcDe', 'bottom')).toBe('BDace')
  })

  it('steps one place past the next listed sibling', () => {
    expect(apply('aBc', 'up')).toBe('acB')
    expect(apply('aBc', 'down')).toBe('Bac')
  })

  it('passes over siblings the panel does not list', () => {
    expect(apply('aB..c', 'up')).toBe('a..cB')
    expect(apply('a..Bc', 'down')).toBe('Ba..c')
  })

  it('leaves what is already at the end, and what is held under it, in place', () => {
    expect(apply('abCD', 'up')).toBe('abCD')
    expect(apply('ABcd', 'down')).toBe('ABcd')
  })

  it('moves a selected block together and keeps its order', () => {
    expect(apply('aBCd', 'up')).toBe('adBC')
    expect(apply('aBCd', 'down')).toBe('BCad')
  })
})
