import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, RasterLayerEntry, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import {
  findEntry,
  findTextObject,
  visibleTextObjects,
  insertAtPath,
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
    x: 0,
    y: 0,
    groupId: null,
    rotation: 0,
    lines: [id],
    ...extra,
  }
}

function group(id: string, children: LayerEntry[], visible = true): GroupLayerEntry {
  return { kind: 'group', id, name: id, visible, locked: false, children }
}

function raster(id: string): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    file: `${id}.png`,
    opacity: 1,
    blendMode: 'normal',
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

describe('visibleTextObjects', () => {
  it('draws in tree order, which is the stacking order', () => {
    const layers = [text('a'), text('b')]
    expect(idsOf(visibleTextObjects(manifest(layers, ['b', 'a'])))).toEqual(['a', 'b'])
  })

  it('leaves out a hidden object', () => {
    const layers = [text('a', { visible: false }), text('b')]
    expect(idsOf(visibleTextObjects(manifest(layers, ['a', 'b'])))).toEqual(['b'])
  })

  it('leaves out a visible object inside a hidden folder', () => {
    const layers = [group('g', [text('a')], false), text('b')]
    expect(idsOf(visibleTextObjects(manifest(layers, ['a', 'b'])))).toEqual(['b'])
  })

  it('leaves out a visible object nested under a hidden ancestor', () => {
    const layers = [group('g', [group('h', [text('a')])], false)]
    expect(visibleTextObjects(manifest(layers, ['a']))).toEqual([])
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
