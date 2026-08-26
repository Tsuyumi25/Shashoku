import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineFontSource } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import {
  catalog,
  catalogByFace,
  catalogByFamily,
  chosenDefaultFamily,
  defaultFamily,
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

/** A face at a path of its own, which is what the stubbed engine answers by. */
function faceAt(family: string, path: string, kind: 'system' | 'imported' = 'system'): FontEntry {
  return face({
    family,
    displayName: family,
    postscriptName: `${family}-Regular`,
    origin: { kind, path, faceIndex: 0 },
  })
}

/** Which of the stubbed fonts can draw everything asked of them. */
let drawable = new Set<string>()
let asked: string[] = []

Object.assign(globalThis, {
  window: {
    engine: {
      uncoveredClusters: (font: EngineFontSource) => {
        // Optional on the surface, for the faces whose only handle is bytes.
        const path = font.path ?? ''
        asked.push(path)
        return drawable.has(path) ? [] : [0]
      },
    },
  },
})

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

describe('defaultFamily', () => {
  beforeEach(() => {
    chosenDefaultFamily.value = ''
    drawable = new Set()
    asked = []
  })

  /**
   * ⭐ Checked rather than taken in order. The catalogue is sorted by display
   * name, so its first system family is whichever sorts first — usually a Latin
   * face, which would draw this kind of work as boxes from end to end. That is
   * the picture having no font at all gives, reached the long way round.
   */
  it('takes the first system family that can set the sample', () => {
    catalog.value = [faceAt('Latin', '/latin.ttf'), faceAt('Kanji', '/kanji.ttf')]
    drawable.add('/kanji.ttf')
    expect(defaultFamily.value).toBe('Kanji')
  })

  /**
   * ⚠️ A folder somebody added is a choice about their work. What is answered
   * here is what to draw before anybody has chosen anything.
   */
  it('never takes a family the user imported, even where it would serve', () => {
    catalog.value = [faceAt('Mine', '/mine.ttf', 'imported'), faceAt('Theirs', '/sys.ttf')]
    drawable.add('/mine.ttf')
    drawable.add('/sys.ttf')
    expect(defaultFamily.value).toBe('Theirs')
  })

  it('answers with the family somebody chose', () => {
    catalog.value = [faceAt('First', '/first.ttf'), faceAt('Chosen', '/chosen.ttf')]
    drawable.add('/first.ttf')
    drawable.add('/chosen.ttf')
    chosenDefaultFamily.value = 'Chosen'
    expect(defaultFamily.value).toBe('Chosen')
  })

  /**
   * ⭐ So a preferences file carried between two machines leaves neither of
   * them drawing boxes for want of the other's font.
   */
  it('picks for itself when the chosen family is not on this machine', () => {
    catalog.value = [faceAt('Here', '/here.ttf')]
    drawable.add('/here.ttf')
    chosenDefaultFamily.value = 'Elsewhere'
    expect(defaultFamily.value).toBe('Here')
  })

  /** Which leaves the boxes, the same as before — there is nothing to draw with. */
  it('answers with nothing when no system family can set the sample', () => {
    catalog.value = [faceAt('Latin', '/latin.ttf')]
    expect(defaultFamily.value).toBe('')
  })

  it('asks about a family once however many faces it has', () => {
    catalog.value = [
      faceAt('Many', '/many.ttf'),
      face({
        family: 'Many',
        displayName: 'Many',
        style: 'Bold',
        weight: 700,
        postscriptName: 'Many-Bold',
        origin: { kind: 'system', path: '/many-bold.ttf', faceIndex: 0 },
      }),
      faceAt('Next', '/next.ttf'),
    ]
    drawable.add('/next.ttf')
    expect(defaultFamily.value).toBe('Next')
    expect(asked).toEqual(['/many.ttf', '/next.ttf'])
  })
})
