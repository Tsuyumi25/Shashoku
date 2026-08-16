import { describe, expect, it } from 'vitest'
import { candidatesFor, settleReadings, sourceForNewObject, type Settleable } from './candidates'
import type { OcrCandidatePersisted, TextSource } from '../page/types'

const read = (over: Partial<OcrCandidatePersisted> = {}): OcrCandidatePersisted => ({
  hash: 'h1',
  source: 'manga-ocr',
  text: 'ふん！',
  original: 'ふん！',
  x: 100,
  y: 100,
  w: 100,
  h: 100,
  confidence: 0.9,
  label: 'text_bubble',
  ...over,
})

const empty: TextSource = { hash: null, by: 'auto' }
const object = (source: TextSource = empty, ownSource = '') => ({ source, ownSource })

// Big enough that the page-relative rule never decides a case about the other.
const PAGE = { width: 6000, height: 6000 }

describe('candidatesFor', () => {
  it('offers a reading of the region next to the one it stands on', () => {
    const pool = [read(), read({ hash: 'h2', x: 250, y: 100 })]
    const rows = candidatesFor(object(), { x: 150, y: 150 }, pool, PAGE)
    expect(rows.filter((r) => r.hash !== 'own')).toHaveLength(2)
  })

  /**
   * The other half of the same rule. A reading read across the page is not an
   * alternative reading of this object — it is a reading of something else, and
   * offering it is what buries the two or three that could be meant.
   */
  it('drops a reading read too far away to be about this object', () => {
    const pool = [read({ hash: 'here' }), read({ hash: 'across', x: 2000, y: 2000 })]
    const rows = candidatesFor(object(), { x: 150, y: 150 }, pool, PAGE).filter((r) => r.hash !== 'own')
    expect(rows.map((r) => r.hash)).toEqual(['here'])
  })

  /**
   * What the box-relative rule cannot say. A caption spanning the artwork has a
   * circle as wide as the caption, so things a long way off fall inside it —
   * and being inside a wide thing's circle is not the same as being near it.
   */
  it('drops a reading a wide box reaches only because it is wide', () => {
    const pool = [
      read({ hash: 'caption', x: 0, y: 0, w: 2000, h: 200 }),
      read({ hash: 'beside', x: 2950, y: 50, w: 100, h: 100 }),
    ]
    const rows = candidatesFor(object(), { x: 3000, y: 100 }, pool, PAGE).filter(
      (r) => r.hash !== 'own',
    )
    expect(rows.map((r) => r.hash)).toEqual(['beside'])
  })

  /**
   * And why that rule is measured from the box's edge. Somebody lettering one
   * end of a caption stands a long way from its middle and no distance at all
   * from the caption; measuring to the middle would take it away from them.
   */
  it('keeps a wide caption for an object standing at one end of it', () => {
    const pool = [read({ hash: 'caption', x: 0, y: 0, w: 2000, h: 200 })]
    const rows = candidatesFor(object(), { x: 1900, y: 100 }, pool, PAGE).filter(
      (r) => r.hash !== 'own',
    )
    expect(rows.map((r) => r.hash)).toEqual(['caption'])
  })

  /**
   * Distance wins outright. A reading further away is further away whatever a
   * model thinks of it, and a confident reading of the balloon next door is
   * still a reading of the balloon next door.
   */
  it('puts the nearer reading above the surer one', () => {
    const pool = [
      read({ hash: 'near', confidence: 0.6, x: 100, y: 100 }),
      read({ hash: 'far', confidence: 0.99, x: 200, y: 200 }),
    ]
    const rows = candidatesFor(object(), { x: 150, y: 150 }, pool, PAGE).filter((r) => r.hash !== 'own')
    expect(rows.map((r) => r.hash)).toEqual(['near', 'far'])
  })

  /**
   * The only case confidence decides — and it is not a coincidence. Two
   * recognizers reading one box share the box, so they share its distance
   * exactly, and nothing but confidence is left to tell them apart.
   */
  it('lets confidence settle two readings of one box', () => {
    const pool = [
      read({ hash: 'unsure', source: 'manga-ocr', confidence: 0.7 }),
      read({ hash: 'sure', source: 'ppocr', confidence: 0.99 }),
    ]
    const rows = candidatesFor(object(), { x: 150, y: 150 }, pool, PAGE).filter((r) => r.hash !== 'own')
    expect(rows.map((r) => r.hash)).toEqual(['sure', 'unsure'])
  })

  /**
   * Reach is counted in places, not rows, so asking a second recognizer does
   * not halve how far the list sees.
   */
  it('reaches as many places whether one recognizer read them or two', () => {
    const places = [0, 1, 2].map((i) => ({ x: i * 50, y: 0, w: 100, h: 100 }))
    const alone = places.map((at, i) => read({ hash: `a${i}`, ...at }))
    const both = alone.concat(places.map((at, i) => read({ hash: `b${i}`, source: 'ppocr', ...at })))

    const one = candidatesFor(object(), { x: 0, y: 0 }, alone, PAGE, 2)
    const two = candidatesFor(object(), { x: 0, y: 0 }, both, PAGE, 2)

    expect(one.filter((r) => r.hash !== 'own')).toHaveLength(2)
    expect(two.filter((r) => r.hash !== 'own')).toHaveLength(4)
  })

  it('drops the places past the count, even where all of them are near', () => {
    const pool = [0, 1, 2].map((i) => read({ hash: `h${i}`, x: i * 50, y: 0 }))
    const rows = candidatesFor(object(), { x: 0, y: 0 }, pool, PAGE, 2).filter((r) => r.hash !== 'own')
    expect(rows.map((r) => r.hash).sort()).toEqual(['h0', 'h1'])
  })

  it('stands the reading in the slot first, marked as the one it stands for', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', x: 200 })]
    const rows = candidatesFor(object({ hash: 'a', by: 'human' }), { x: 150, y: 150 }, pool, PAGE)
    expect(rows[0]).toMatchObject({ hash: 'a', held: true })
    expect(rows.filter((r) => r.held)).toHaveLength(1)
  })

  // The object was carried away from what it stands for; the choice stands.
  it('keeps the reading in the slot even where it is now far out of reach', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', x: 5000, y: 5000 })]
    const rows = candidatesFor(object({ hash: 'b', by: 'human' }), { x: 150, y: 150 }, pool, PAGE)
    expect(rows[0]).toMatchObject({ hash: 'b', held: true })
  })

  it('lets the slot past the count as well, without costing a place', () => {
    const pool = [0, 1, 2].map((i) => read({ hash: `h${i}`, x: i * 50, y: 0 }))
    const rows = candidatesFor(object({ hash: 'h2', by: 'human' }), { x: 0, y: 0 }, pool, PAGE, 2)
    expect(rows.map((r) => r.hash)).toEqual(['h2', 'h0', 'h1'])
  })

  it("stands the object's own source above the readings, out of the sort", () => {
    const pool = [read({ confidence: 1 })]
    const rows = candidatesFor(object(empty, '自分で書いた'), { x: 150, y: 150 }, pool, PAGE)
    expect(rows[0]).toMatchObject({ hash: 'own', text: '自分で書いた', confidence: null })
  })

  it('marks the own row when it is the one in the slot', () => {
    const rows = candidatesFor(object({ hash: 'own', by: 'human' }, 'x'), { x: 0, y: 0 }, [read()], PAGE)
    expect(rows[0]).toMatchObject({ hash: 'own', held: true })
  })

  it('offers no own row until somebody has written one', () => {
    const rows = candidatesFor(object(), { x: 0, y: 0 }, [], PAGE)
    expect(rows).toHaveLength(0)
  })
})

describe('settleReadings', () => {
  const at = (
    id: string,
    x: number,
    y: number,
    source: TextSource = empty,
    heldConfidence: number | null = null,
  ): Settleable => ({
    id,
    centre: { x, y },
    source,
    heldConfidence,
  })

  /**
   * The case that made the direction matter. Four objects clustered near one
   * balloon must not all end up standing for the same sentence — a reading was
   * read in one place and belongs in one place.
   */
  it('never puts one reading on two objects', () => {
    // The reading's box is centred on 'a'; the other three stand nearby.
    const objects = [at('a', 100, 100), at('b', 130, 100), at('c', 160, 100), at('d', 190, 100)]
    const born = [read({ hash: 'only', x: 80, y: 80, w: 40, h: 40 })]
    const settled = settleReadings(objects, born)
    expect(settled.size).toBe(1)
    expect([...settled.keys()]).toEqual(['a'])
  })

  it('sends each reading to the object nearest it', () => {
    const objects = [at('left', 0, 0), at('right', 1000, 0)]
    // Each box is centred on the object it belongs to.
    const born = [
      read({ hash: 'nearLeft', x: -50, y: -50, w: 100, h: 100 }),
      read({ hash: 'nearRight', x: 950, y: -50, w: 100, h: 100 }),
    ]
    const settled = settleReadings(objects, born)
    expect(settled.get('left')?.hash).toBe('nearLeft')
    expect(settled.get('right')?.hash).toBe('nearRight')
  })

  it('gives an object the nearest of the readings that chose it', () => {
    const objects = [at('only', 0, 0)]
    // Both boxes reach the object; only one of them is centred near it.
    const born = [
      read({ hash: 'far', x: -600, y: -400, w: 800, h: 800, confidence: 0.99 }),
      read({ hash: 'near', x: -50, y: -50, w: 100, h: 100, confidence: 0.75 }),
    ]
    expect(settleReadings(objects, born).get('only')?.hash).toBe('near')
  })

  /** Two recognizers reading one box tie exactly; nothing but confidence is left. */
  it('lets confidence settle two readings of one box', () => {
    const objects = [at('only', 0, 0)]
    const born = [
      read({ hash: 'unsure', source: 'manga-ocr', x: -50, y: -50, confidence: 0.75 }),
      read({ hash: 'sure', source: 'ppocr', x: -50, y: -50, confidence: 0.99 }),
    ]
    expect(settleReadings(objects, born).get('only')?.hash).toBe('sure')
  })

  it('does nothing at all when a run brought nothing new', () => {
    expect(settleReadings([at('a', 0, 0)], []).size).toBe(0)
  })

  it('never touches a slot a person answered for', () => {
    const held: TextSource = { hash: 'old', by: 'human' }
    const near = read({ hash: 'new', x: -50, y: -50 })
    expect(settleReadings([at('a', 0, 0, held, 0.1)], [near]).size).toBe(0)
  })

  it('never touches a slot a person emptied', () => {
    const emptied: TextSource = { hash: null, by: 'human' }
    const near = read({ hash: 'new', x: -50, y: -50 })
    expect(settleReadings([at('a', 0, 0, emptied)], [near]).size).toBe(0)
  })

  it('lets a surer reading take over one a previous run put there', () => {
    const filled: TextSource = { hash: 'old', by: 'auto' }
    const near = read({ hash: 'new', x: -50, y: -50, confidence: 0.95 })
    expect(settleReadings([at('a', 0, 0, filled, 0.8)], [near]).get('a')?.hash).toBe('new')
  })

  it('leaves a reading in place when the newcomer is no surer', () => {
    const filled: TextSource = { hash: 'old', by: 'auto' }
    const near = read({ hash: 'new', x: -50, y: -50, confidence: 0.8 })
    expect(settleReadings([at('a', 0, 0, filled, 0.8)], [near]).size).toBe(0)
  })

  /**
   * A reading stops at the object nearest it rather than looking further on.
   * Landing a sentence on an object it was not read anywhere near is worse than
   * leaving a slot for someone to fill by hand.
   */
  it('does not fall through to a second object when the nearest is settled', () => {
    const answered: TextSource = { hash: null, by: 'human' }
    const objects = [at('near', 0, 0, answered), at('far', 900, 0)]
    expect(settleReadings(objects, [read({ hash: 'x', x: -50, y: -50 })]).size).toBe(0)
  })

  it('settles nothing on a page with no objects', () => {
    expect(settleReadings([], [read()]).size).toBe(0)
  })
})

describe('sourceForNewObject', () => {
  // A balloon the size of the ones on a real page, at the origin.
  const balloon = (over = {}) => read({ x: 0, y: 0, w: 300, h: 1000, ...over })

  it('stands for the reading it was made inside', () => {
    const centre = { x: 150, y: 500 }
    expect(sourceForNewObject(centre, [balloon({ hash: 'mine' })])).toEqual({
      hash: 'mine',
      by: 'auto',
    })
  })

  /**
   * Placed nowhere near anything, an object stands for nothing — and the slot
   * is left unanswered rather than settled, so the next run may still fill it.
   */
  it('stands for nothing when it was made away from everything', () => {
    const far = { x: 4000, y: 4000 }
    expect(sourceForNewObject(far, [balloon()])).toEqual({ hash: null, by: 'auto' })
  })

  it('will not take a reading the recognizer barely believes', () => {
    const centre = { x: 150, y: 500 }
    const noise = [balloon({ hash: 'noise', confidence: 0.4 })]
    expect(sourceForNewObject(centre, noise).hash).toBeNull()
  })

  it('takes the nearer of two it is inside', () => {
    const pool = [
      balloon({ hash: 'far', x: 0, y: 0 }),
      balloon({ hash: 'near', x: 200, y: 400 }),
    ]
    expect(sourceForNewObject({ x: 350, y: 900 }, pool).hash).toBe('near')
  })

  it('lets confidence settle two readings of one box', () => {
    const pool = [
      balloon({ hash: 'unsure', source: 'manga-ocr', confidence: 0.8 }),
      balloon({ hash: 'sure', source: 'ppocr', confidence: 0.99 }),
    ]
    expect(sourceForNewObject({ x: 150, y: 500 }, pool).hash).toBe('sure')
  })

  /**
   * The rule is a proportion of the reading's own box, so the same placement
   * decides the same way whatever size the page is.
   */
  it('decides the same way on a page three times the size', () => {
    const small = sourceForNewObject({ x: 150, y: 500 }, [balloon({ hash: 's' })])
    const large = sourceForNewObject(
      { x: 450, y: 1500 },
      [balloon({ hash: 'l', w: 900, h: 3000 })],
    )
    expect(small.hash).toBe('s')
    expect(large.hash).toBe('l')
  })

  it('stands for nothing on a page nothing has been read on', () => {
    expect(sourceForNewObject({ x: 0, y: 0 }, []).hash).toBeNull()
  })
})

describe('settleReadings keeps its distance too', () => {
  it('will not send a reading across the page to the only object there', () => {
    const objects: Settleable[] = [
      { id: 'far', centre: { x: 4000, y: 4000 }, source: empty, heldConfidence: null },
    ]
    expect(settleReadings(objects, [read({ x: 0, y: 0, w: 100, h: 100 })]).size).toBe(0)
  })

  it('will not settle a reading the recognizer barely believes', () => {
    const objects: Settleable[] = [
      { id: 'here', centre: { x: 150, y: 150 }, source: empty, heldConfidence: null },
    ]
    const noise = [read({ x: 100, y: 100, w: 100, h: 100, confidence: 0.4 })]
    expect(settleReadings(objects, noise).size).toBe(0)
  })
})
