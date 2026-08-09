import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { validatePage } from './validate'
import type { ReadingEdge } from './readingGraph'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'

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
    tags: [],
    rotation: 0,
    lines: [id],
    style: { ...DEFAULT_TEXT_STYLE },
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

function manifest(
  layers: LayerEntry[],
  readingOrder: string[],
  readingEdges: ReadingEdge[] = [],
): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, name: 'p', width: 1200, height: 1700, readingOrder, readingEdges, layers }
}

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
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

describe('the lines drawn between objects', () => {
  it('finds nothing wrong with lines between objects that are all there', () => {
    expect(validatePage(manifest([text('a'), text('b')], ['a', 'b'], edges('a>b')))).toEqual([])
  })

  it('names a line reaching for an object that is not on the page', () => {
    expect(validatePage(manifest([text('a')], ['a'], edges('a>ghost')))).toEqual([
      { kind: 'reading-edge-dangling', id: 'a', to: 'ghost' },
    ])
  })

  // A line to a folder or a raster is the same fault as a line to nothing: the
  // reading is between translations, and neither of those is one.
  it('names a line reaching for something that is not a text object', () => {
    expect(
      validatePage(manifest([text('a'), group('g', [])], ['a'], edges('g>a'))),
    ).toEqual([{ kind: 'reading-edge-dangling', id: 'g', to: 'a' }])
  })

  /**
   * A ring cannot be drawn — the canvas refuses the line that would close one —
   * so this only catches a file written somewhere else. It matters because the
   * gutter number is the longest path from an object nothing points into, and a
   * ring has neither.
   */
  it('names the line that closes a ring', () => {
    const defects = validatePage(
      manifest([text('a'), text('b')], ['a', 'b'], edges('a>b', 'b>a')),
    )
    expect(defects).toEqual([{ kind: 'reading-edge-cycle', id: 'b', to: 'a' }])
  })

  it('leaves two chains that meet again alone, which is not a ring', () => {
    const page = manifest(
      [text('a'), text('b'), text('c'), text('d')],
      ['a', 'b', 'c', 'd'],
      edges('a>b', 'a>c', 'b>d', 'c>d'),
    )
    expect(validatePage(page)).toEqual([])
  })
})
