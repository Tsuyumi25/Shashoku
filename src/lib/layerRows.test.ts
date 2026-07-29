import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import { flattenLayerRows } from '@/lib/layerRows'

function text(id: string, visible = true): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible,
    locked: false,
    x: 0,
    y: 0,
    groupId: null,
    rotation: 0,
    lines: [id],
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

const idsOf = (rows: readonly { entry: LayerEntry }[]): string[] => rows.map((r) => r.entry.id)

describe('flattenLayerRows', () => {
  // The last entry is drawn last, so it is the one on top — and a layer panel
  // that put the topmost at the bottom would read backwards to anyone who has
  // used one before.
  it('shows the topmost first', () => {
    expect(idsOf(flattenLayerRows([text('under'), text('over')], new Set()))).toEqual([
      'over',
      'under',
    ])
  })

  it('puts a folder above its own contents and indents them', () => {
    const rows = flattenLayerRows([group('g', [text('a'), text('b')])], new Set())
    expect(idsOf(rows)).toEqual(['g', 'b', 'a'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1])
  })

  // Paths address the real array, which is what the store's edits take, so they
  // keep counting from the bottom however the panel chooses to show them.
  it('names each entry by where it actually sits', () => {
    const rows = flattenLayerRows([raster('r'), group('g', [text('a'), text('b')])], new Set())
    expect(rows.map((r) => [r.entry.id, r.path])).toEqual([
      ['g', [1]],
      ['b', [1, 1]],
      ['a', [1, 0]],
      ['r', [0]],
    ])
  })

  it('keeps a collapsed folder and drops what is inside it', () => {
    const rows = flattenLayerRows([group('g', [text('a')]), text('b')], new Set(['g']))
    expect(idsOf(rows)).toEqual(['b', 'g'])
  })

  it('collapses a folder nested inside an open one', () => {
    const rows = flattenLayerRows([group('outer', [group('inner', [text('a')])])], new Set(['inner']))
    expect(idsOf(rows)).toEqual(['outer', 'inner'])
  })

  it('goes several levels deep', () => {
    const rows = flattenLayerRows([group('a', [group('b', [text('c')])])], new Set())
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2])
  })

  /**
   * The thing a flat list cannot express: an object whose own flag says visible
   * but which is inside a folder that is off. The tree is where that is
   * visible, so it has to be told apart from being hidden outright.
   */
  it('marks what a hidden folder takes down with it', () => {
    const rows = flattenLayerRows([group('g', [text('a'), text('b', false)], false)], new Set())
    expect(rows.map((r) => [r.entry.id, r.entry.visible, r.hiddenByAncestor])).toEqual([
      ['g', false, false],
      ['b', false, true],
      ['a', true, true],
    ])
  })

  it('leaves what is inside a shown folder unmarked', () => {
    const rows = flattenLayerRows([group('g', [text('a')])], new Set())
    expect(rows.every((r) => !r.hiddenByAncestor)).toBe(true)
  })
})
