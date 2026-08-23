import { describe, expect, it } from 'vitest'
import type { LayerEffect } from './types'
import { cloneEffects } from './clone'

/**
 * A list crossing from one node to another must share nothing mutable with it.
 * Two nodes holding one array is a corruption waiting for whoever next edits an
 * effect in place instead of replacing the list.
 */
describe('cloneEffects', () => {
  it('shares neither the list nor anything in it', () => {
    const source: LayerEffect[] = [
      { kind: 'stroke', width: 3, color: '#000000', position: 'outside' },
    ]

    const copy = cloneEffects(source)

    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy[0]).not.toBe(source[0])
  })
})
