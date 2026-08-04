import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { GroupLayerEntry, LayerEntry, ManifestJson, RasterLayerEntry, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import {
  dissolveGroupAt,
  findEntry,
  findTextObject,
  moveEntry,
  restoreGroupAt,
  insertAtPath,
  isLocked,
  isMergeable,
  outermostEntries,
  pathOf,
  removeAtPath,
  textObjects,
  textObjectsInReadingOrder,
} from './tree'

function text(id: string, extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    tags: [],
    rotation: 0,
    lines: [id],
    style: { ...DEFAULT_TEXT_STYLE },
    provenance: {},
    ...extra,
  }
}

function group(id: string, children: LayerEntry[], visible = true): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible,
    locked: false,
    opacity: 1,
    blendMode: PASS_THROUGH,
    children,
  }
}

function raster(id: string): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    alphaLocked: false,
  }
}

function manifest(layers: LayerEntry[], readingOrder: string[]): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder, layers }
}

const idsOf = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id)

describe('textObjects', () => {
  it('reaches text inside groups, in tree order', () => {
    const layers = [text('a'), group('g', [text('b'), group('h', [text('c')])]), text('d')]
    expect(idsOf(textObjects(layers))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('leaves the containers and the pixels out', () => {
    const layers = [raster('r'), group('g', [text('a')])]
    expect(idsOf(textObjects(layers))).toEqual(['a'])
  })
})

describe('textObjectsInReadingOrder', () => {
  it('answers in reading order rather than tree order', () => {
    const layers = [text('a'), text('b'), text('c')]
    expect(idsOf(textObjectsInReadingOrder(manifest(layers, ['c', 'a', 'b'])))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('reaches text nested in groups', () => {
    const layers = [group('g', [text('b')]), text('a')]
    expect(idsOf(textObjectsInReadingOrder(manifest(layers, ['a', 'b'])))).toEqual(['a', 'b'])
  })

  // The rule the whole split exists to keep: an object the order does not
  // mention is absent, never quietly restored from the tree's own order.
  it('never falls back to the tree for an object the order omits', () => {
    const layers = [text('a'), text('b')]
    expect(idsOf(textObjectsInReadingOrder(manifest(layers, ['a'])))).toEqual(['a'])
  })

  it('skips an id no text object answers to', () => {
    const layers = [text('a'), raster('r'), group('g', [])]
    expect(idsOf(textObjectsInReadingOrder(manifest(layers, ['a', 'gone', 'r', 'g'])))).toEqual([
      'a',
    ])
  })
})


describe('findEntry', () => {
  it('finds a folder as readily as an object', () => {
    const layers = [group('g', [text('a')])]
    expect(findEntry(layers, 'g')?.kind).toBe('group')
    expect(findEntry(layers, 'a')?.kind).toBe('text')
  })

  it('reaches something buried a few levels down', () => {
    expect(findEntry([group('g', [group('h', [raster('r')])])], 'r')?.kind).toBe('raster')
  })

  it('answers undefined for an id nothing answers to', () => {
    expect(findEntry([text('a')], 'zz')).toBeUndefined()
  })
})

describe('findTextObject', () => {
  it('finds one nested in a group', () => {
    expect(findTextObject([group('g', [text('a')])], 'a')?.id).toBe('a')
  })

  it('answers undefined for a group of the same id', () => {
    expect(findTextObject([group('g', [])], 'g')).toBeUndefined()
  })
})

describe('moveEntry', () => {
  const layout = (): LayerEntry[] => [
    text('a'),
    group('g', [text('b'), text('c')]),
    text('d'),
  ]

  it('restacks within one level', () => {
    const layers = layout()
    expect(moveEntry(layers, [0], { parentPath: [], index: 3 })).toBe(true)
    expect(layers.map((e) => e.id)).toEqual(['g', 'd', 'a'])
  })

  // Taking the entry out first shifts everything after it down one, so an
  // index taken from the tree as the user saw it no longer means what it said.
  it('lands where it was aimed when moving down its own level', () => {
    const layers = layout()
    moveEntry(layers, [0], { parentPath: [], index: 2 })
    expect(layers.map((e) => e.id)).toEqual(['g', 'a', 'd'])
  })

  it('lands where it was aimed when moving up its own level', () => {
    const layers = layout()
    moveEntry(layers, [2], { parentPath: [], index: 0 })
    expect(layers.map((e) => e.id)).toEqual(['d', 'a', 'g'])
  })

  it('files an entry into a folder', () => {
    const layers = layout()
    expect(moveEntry(layers, [0], { parentPath: [1], index: 1 })).toBe(true)
    expect(layers.map((e) => e.id)).toEqual(['g', 'd'])
    expect((layers[0] as GroupLayerEntry).children.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('takes an entry back out of a folder', () => {
    const layers = layout()
    expect(moveEntry(layers, [1, 0], { parentPath: [], index: 0 })).toBe(true)
    expect(layers.map((e) => e.id)).toEqual(['b', 'a', 'g', 'd'])
    expect((layers[2] as GroupLayerEntry).children.map((e) => e.id)).toEqual(['c'])
  })

  it('corrects a destination that sat after the hole left behind', () => {
    const layers: LayerEntry[] = [text('a'), group('g', [text('b')])]
    expect(moveEntry(layers, [0], { parentPath: [1], index: 0 })).toBe(true)
    expect((layers[0] as GroupLayerEntry).children.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('refuses to put a folder inside itself', () => {
    const layers = layout()
    const before = JSON.stringify(layers)
    expect(moveEntry(layers, [1], { parentPath: [1], index: 0 })).toBe(false)
    expect(JSON.stringify(layers)).toBe(before)
  })

  it('refuses to put a folder inside something it already contains', () => {
    const layers: LayerEntry[] = [group('outer', [group('inner', [])])]
    expect(moveEntry(layers, [0], { parentPath: [0, 0], index: 0 })).toBe(false)
    expect(layers.map((e) => e.id)).toEqual(['outer'])
  })

  it('refuses a source that leads nowhere', () => {
    const layers = layout()
    expect(moveEntry(layers, [9], { parentPath: [], index: 0 })).toBe(false)
  })

  it('refuses a destination that is not a folder', () => {
    const layers = layout()
    expect(moveEntry(layers, [0], { parentPath: [2], index: 0 })).toBe(false)
    expect(layers.map((e) => e.id)).toEqual(['a', 'g', 'd'])
  })

  it('leaves the entries themselves untouched, so nothing about reading changes', () => {
    const layers = layout()
    moveEntry(layers, [0], { parentPath: [1], index: 0 })
    expect(idsOf(textObjects(layers)).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('pathOf / removeAtPath / insertAtPath', () => {
  it('names where an entry sits', () => {
    const layers = [text('a'), group('g', [text('b'), text('c')])]
    expect(pathOf(layers, 'c')).toEqual([1, 1])
  })

  it('answers null for an id nothing answers to', () => {
    expect(pathOf([text('a')], 'zz')).toBeNull()
  })

  it('puts back what it took, where it was', () => {
    const layers: LayerEntry[] = [text('a'), group('g', [text('b'), text('c')]), text('d')]
    const before = JSON.stringify(layers)

    const path = pathOf(layers, 'c')
    expect(path).not.toBeNull()
    const taken = removeAtPath(layers, path as number[])
    expect(taken?.id).toBe('c')
    expect(idsOf(textObjects(layers))).toEqual(['a', 'b', 'd'])

    insertAtPath(layers, path as number[], taken as LayerEntry)
    expect(JSON.stringify(layers)).toBe(before)
  })

  it('appends when the path points one past the end', () => {
    const layers: LayerEntry[] = [text('a')]
    insertAtPath(layers, [1], text('b'))
    expect(idsOf(textObjects(layers))).toEqual(['a', 'b'])
  })

  it('refuses a path that leads nowhere', () => {
    const layers: LayerEntry[] = [text('a')]
    expect(removeAtPath(layers, [4])).toBeNull()
    expect(removeAtPath(layers, [0, 2])).toBeNull()
  })
})

describe('dissolveGroupAt / restoreGroupAt', () => {
  it('leaves what a folder held exactly where the folder was', () => {
    const layers: LayerEntry[] = [text('a'), group('g', [text('b'), text('c')]), text('d')]
    const folder = dissolveGroupAt(layers, [1])
    expect(folder?.id).toBe('g')
    expect(layers.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('just takes an empty folder away', () => {
    const layers: LayerEntry[] = [text('a'), group('g', [])]
    expect(dissolveGroupAt(layers, [1])?.id).toBe('g')
    expect(layers.map((e) => e.id)).toEqual(['a'])
  })

  it('dissolves one nested inside another', () => {
    const layers: LayerEntry[] = [group('outer', [text('a'), group('inner', [text('b')])])]
    expect(dissolveGroupAt(layers, [0, 1])?.id).toBe('inner')
    expect((layers[0] as GroupLayerEntry).children.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('refuses anything that is not a folder', () => {
    const layers: LayerEntry[] = [text('a')]
    expect(dissolveGroupAt(layers, [0])).toBeNull()
    expect(layers.map((e) => e.id)).toEqual(['a'])
  })

  it('puts the folder back around exactly what it held', () => {
    const layers: LayerEntry[] = [text('a'), group('g', [text('b'), text('c')]), text('d')]
    const before = JSON.stringify(layers)
    const folder = dissolveGroupAt(layers, [1])

    expect(restoreGroupAt(layers, [1], folder as GroupLayerEntry)).toBe(true)
    expect(JSON.stringify(layers)).toBe(before)
  })
})

describe('isLocked', () => {
  const locked = <T extends LayerEntry>(entry: T): T => ({ ...entry, locked: true })

  it('answers a lock an entry put on itself', () => {
    expect(isLocked([locked(text('a')), text('b')], 'a')).toBe(true)
    expect(isLocked([locked(text('a')), text('b')], 'b')).toBe(false)
  })

  /**
   * What gets dragged and deleted by accident is the children, so locking only
   * the shell would lock a room with no door.
   */
  it("passes a folder's lock down to what it holds", () => {
    const layers = [locked(group('g', [text('a')])), text('b')]
    expect(isLocked(layers, 'a')).toBe(true)
    expect(isLocked(layers, 'b')).toBe(false)
  })

  it('reaches down however many folders deep it has to', () => {
    const layers = [locked(group('g', [group('h', [group('i', [text('a')])])]))]
    expect(isLocked(layers, 'a')).toBe(true)
  })

  it('leaves a sibling branch alone', () => {
    const layers = [locked(group('g', [text('a')])), group('h', [text('b')])]
    expect(isLocked(layers, 'b')).toBe(false)
  })

  // Nothing is protected by a lock it does not have.
  it('answers false for an entry that is not on this page', () => {
    expect(isLocked([text('a')], 'elsewhere')).toBe(false)
  })
})

describe('isMergeable', () => {
  it('takes pixels', () => {
    expect(isMergeable(raster('r'))).toBe(true)
  })

  /**
   * Nothing paints across a translation, and the export bakes the lettering in
   * anyway — so the one need merge exists for never points at a text object.
   */
  it('never takes a text object', () => {
    expect(isMergeable(text('a'))).toBe(false)
  })

  it('takes a folder of nothing but pixels', () => {
    expect(isMergeable(group('g', [raster('r'), group('h', [raster('s')])]))).toBe(true)
  })

  it('refuses a folder holding a translation, however deep', () => {
    expect(isMergeable(group('g', [raster('r'), group('h', [text('a')])]))).toBe(false)
  })

  it('takes an empty folder, which contributes nothing', () => {
    expect(isMergeable(group('g', []))).toBe(true)
  })
})

describe('outermostEntries', () => {
  it('drops a member another member already contains', () => {
    const layers = [group('g', [raster('r')]), raster('s')]
    expect(idsOf(outermostEntries(layers, new Set(['g', 'r', 's'])))).toEqual(['g', 's'])
  })

  it('keeps one nested inside a folder nobody named', () => {
    const layers = [group('g', [raster('r')]), raster('s')]
    expect(idsOf(outermostEntries(layers, new Set(['r', 's'])))).toEqual(['r', 's'])
  })

  // Bottom first, which is the order they are drawn in and merged in.
  it('answers in tree order', () => {
    const layers = [raster('a'), raster('b'), raster('c')]
    expect(idsOf(outermostEntries(layers, new Set(['c', 'a'])))).toEqual(['a', 'c'])
  })

  it('has nothing to say about an empty set', () => {
    expect(outermostEntries([raster('a')], new Set())).toEqual([])
  })
})
