import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { validatePage } from './validate'

function text(id: string): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    groupId: null,
    rotation: 0,
    lines: [id],
  }
}

function group(id: string, children: LayerEntry[]): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: PASS_THROUGH,
    children,
  }
}

function manifest(layers: LayerEntry[], readingOrder: string[]): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder, layers }
}

describe('validatePage', () => {
  it('finds nothing wrong with a page whose order covers it exactly', () => {
    expect(validatePage(manifest([text('a'), group('g', [text('b')])], ['b', 'a']))).toEqual([])
  })

  it('names a text object the order never mentions', () => {
    expect(validatePage(manifest([text('a'), text('b')], ['a']))).toEqual([
      { kind: 'reading-order-missing', id: 'b' },
    ])
  })

  it('names an order entry no text object answers to', () => {
    expect(validatePage(manifest([text('a')], ['a', 'ghost']))).toEqual([
      { kind: 'reading-order-dangling', id: 'ghost' },
    ])
  })

  // Coverage is set equality with the text objects, so a folder standing in the
  // order is as wrong as an id that resolves to nothing.
  it('names an order entry that lands on a folder', () => {
    expect(validatePage(manifest([group('g', [])], ['g']))).toEqual([
      { kind: 'reading-order-dangling', id: 'g' },
    ])
  })

  it('names a repeated order entry once per extra appearance', () => {
    expect(validatePage(manifest([text('a')], ['a', 'a']))).toEqual([
      { kind: 'reading-order-duplicate', id: 'a' },
    ])
  })

  it('names two entries sharing one id', () => {
    expect(validatePage(manifest([text('a'), group('a', [])], ['a']))).toEqual([
      { kind: 'duplicate-id', id: 'a' },
    ])
  })

  it('reports every fault it finds rather than stopping at the first', () => {
    expect(validatePage(manifest([text('a'), text('b')], ['ghost', 'a', 'a']))).toEqual([
      { kind: 'reading-order-duplicate', id: 'a' },
      { kind: 'reading-order-dangling', id: 'ghost' },
      { kind: 'reading-order-missing', id: 'b' },
    ])
  })
})
