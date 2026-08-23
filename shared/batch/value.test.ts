import { describe, expect, it } from 'vitest'
import { sharedValue } from './value'

describe('sharedValue', () => {
  it('has nothing to say about an empty batch', () => {
    expect(sharedValue([], 'size')).toEqual({ kind: 'none' })
  })

  it('hands back the value when everyone agrees', () => {
    expect(sharedValue([{ size: 24 }, { size: 24 }], 'size')).toEqual({ kind: 'one', value: 24 })
  })

  /** Never a first-one-wins guess: showing 24 here would turn a glance into an edit. */
  it('says there is no single answer rather than picking one', () => {
    expect(sharedValue([{ size: 24 }, { size: 48 }], 'size')).toEqual({ kind: 'many' })
  })

  /**
   * The reason it encodes instead of comparing. A node's effects are a list, and
   * two nodes carrying equal lists are two nodes a panel has to show one answer
   * for — identity would say they disagree.
   */
  it('reads a field that holds a list by what is in it, not by which list it is', () => {
    const one = [{ kind: 'stroke', width: 3 }]
    const other = [{ kind: 'stroke', width: 3 }]
    expect(sharedValue([{ effects: one }, { effects: other }], 'effects').kind).toBe('one')
    expect(sharedValue([{ effects: one }, { effects: [] }], 'effects').kind).toBe('many')
  })

  /**
   * Knows nothing about what it is reading — which is what lets one tool answer
   * for a font size, an opacity and a list of effects alike.
   */
  it('answers for whatever shape it is given', () => {
    expect(sharedValue([{ opacity: 1 }, { opacity: 1 }], 'opacity')).toEqual({
      kind: 'one',
      value: 1,
    })
    expect(sharedValue([{ blendMode: 'normal' }, { blendMode: 'multiply' }], 'blendMode')).toEqual({
      kind: 'many',
    })
  })
})
