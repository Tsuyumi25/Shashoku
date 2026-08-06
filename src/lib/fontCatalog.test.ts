import { describe, expect, it } from 'vitest'
import type { FontEntry } from '@shared/fonts/types'
import {
  catalog,
  catalogByFace,
  catalogByFamily,
  faceKey,
  faceOrder,
  representativeOf,
} from './fontCatalog'

function face(patch: Partial<FontEntry>): FontEntry {
  return {
    family: 'Family',
    displayName: 'Family',
    style: 'Regular',
    postscriptName: 'Family-Regular',
    weight: 400,
    width: 100,
    slant: 0,
    origin: { kind: 'system', path: '/fonts/family.ttf', faceIndex: 0 },
    ...patch,
  }
}

describe('faceOrder', () => {
  it('orders by weight inside a family', () => {
    const faces = [
      face({ style: 'Bold', weight: 700 }),
      face({ style: 'Light', weight: 300 }),
      face({ style: 'Regular', weight: 400 }),
    ].sort(faceOrder)
    expect(faces.map((f) => f.style)).toEqual(['Light', 'Regular', 'Bold'])
  })

  it('orders by width before weight, as the Adobe chain does', () => {
    const faces = [
      face({ style: 'Light', weight: 300, width: 100 }),
      face({ style: 'Condensed Bold', weight: 700, width: 75 }),
    ].sort(faceOrder)
    expect(faces[0]!.style).toBe('Condensed Bold')
  })

  it('keeps an upright before its slanted sibling', () => {
    const faces = [face({ style: 'Italic', slant: -12 }), face({ style: 'Regular' })].sort(
      faceOrder,
    )
    expect(faces[0]!.style).toBe('Regular')
  })

  it('falls back to the nine steps where a foundry wrote one number everywhere', () => {
    // Alphabetical would say Bold, Extra-Bold, Regular, Semi-Bold.
    const faces = [
      face({ style: 'Extra-Bold' }),
      face({ style: 'Bold' }),
      face({ style: 'Semi-Bold' }),
      face({ style: 'Regular' }),
    ].sort(faceOrder)
    expect(faces.map((f) => f.style)).toEqual(['Regular', 'Semi-Bold', 'Bold', 'Extra-Bold'])
  })

  it('sorts unrecognised names naturally rather than hiding them', () => {
    const faces = [face({ style: 'W8 mono' }), face({ style: 'W8' })].sort(faceOrder)
    expect(faces.map((f) => f.style)).toEqual(['W8', 'W8 mono'])
  })

  it('ranks a named step before a name off the ladder', () => {
    const faces = [face({ style: '常规' }), face({ style: 'Medium' })].sort(faceOrder)
    expect(faces[0]!.style).toBe('Medium')
  })
})

describe('representativeOf', () => {
  it('prefers the upright regular', () => {
    const regular = face({ style: 'Regular' })
    const picked = representativeOf([
      face({ style: 'Bold', weight: 700 }),
      regular,
      face({ style: 'Italic', slant: -12 }),
    ])
    expect(picked).toBe(regular)
  })

  it('lands on the middle of a family with no regular, upward first', () => {
    // Light and Medium are both 100 from regular; CSS resolves 400 upward.
    const medium = face({ style: 'Medium', weight: 500 })
    const picked = representativeOf([
      face({ style: 'Light', weight: 300 }),
      medium,
      face({ style: 'Bold', weight: 700 }),
    ])
    expect(picked).toBe(medium)
  })

  it('is decided by the declared numbers, not by arrival order', () => {
    const faces = [
      face({ style: 'Bold', weight: 700 }),
      face({ style: 'Medium', weight: 500 }),
    ]
    expect(representativeOf(faces)).toBe(representativeOf([...faces].reverse()))
  })

  it('has nothing to say about an empty family', () => {
    expect(representativeOf([])).toBeNull()
  })
})

describe('the catalogue maps', () => {
  it('holds every face of a family, keyed once', () => {
    catalog.value = [
      face({ style: 'Regular', postscriptName: 'Family-Regular' }),
      face({ style: 'Bold', weight: 700, postscriptName: 'Family-Bold' }),
    ]
    expect(catalogByFamily.value.get('Family')).toHaveLength(2)
    expect(catalogByFace.value.get('Family-Bold')?.style).toBe('Bold')
  })

  it('leaves a face with no PostScript name reachable only through its family', () => {
    catalog.value = [face({ postscriptName: '' })]
    expect(catalogByFace.value.size).toBe(0)
    expect(catalogByFamily.value.get('Family')).toHaveLength(1)
  })

  it('falls back to the file for the key of a nameless face', () => {
    const entry = face({ postscriptName: '', origin: { kind: 'system', path: '/a.ttc', faceIndex: 2 } })
    expect(faceKey(entry)).toBe('/a.ttc#2')
  })
})
