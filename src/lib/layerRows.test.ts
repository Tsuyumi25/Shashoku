import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { dropTargetFor, flattenLayerRows } from '@/lib/layerRows'

function text(id: string, visible = true): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    groupId: null,
    anchor: 'center',
    rotation: 0,
    lines: [id],
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

  /**
   * The lock a row cannot see for itself. Its reason sits on an ancestor that
   * may be collapsed out of sight, so the row has to be able to look different
   * for it — otherwise it simply refuses and says nothing about why.
   */
  it('marks what a locked folder locks under it, apart from the folder itself', () => {
    const layers = [{ ...group('g', [text('a'), { ...text('b'), locked: true }]), locked: true }]
    const rows = flattenLayerRows(layers, new Set())
    expect(rows.map((r) => [r.entry.id, r.entry.locked, r.lockedByAncestor])).toEqual([
      ['g', true, false],
      ['b', true, true],
      ['a', false, true],
    ])
  })

  it('leaves what is inside an unlocked folder unmarked', () => {
    const rows = flattenLayerRows([group('g', [text('a')])], new Set())
    expect(rows.every((r) => !r.lockedByAncestor)).toBe(true)
  })
})

describe('dropTargetFor', () => {
  const rowsOf = (layers: LayerEntry[]) => flattenLayerRows(layers, new Set())

  // Rows read top to bottom while the array counts bottom to top, so landing
  // above a row on screen means landing after it in the array.
  it('reads a drop above a row as the slot after it', () => {
    const rows = rowsOf([text('under'), text('over')])
    const overRow = rows[0]
    expect(dropTargetFor(overRow, 'above')).toEqual({ parentPath: [], index: 2 })
  })

  it('reads a drop below a row as the slot before it', () => {
    const rows = rowsOf([text('under'), text('over')])
    expect(dropTargetFor(rows[0], 'below')).toEqual({ parentPath: [], index: 1 })
  })

  it('keeps the level a nested row belongs to', () => {
    const rows = rowsOf([group('g', [text('a'), text('b')])])
    const bRow = rows.find((r) => r.entry.id === 'b')
    expect(dropTargetFor(bRow!, 'below')).toEqual({ parentPath: [0], index: 1 })
  })

  it('drops into a folder at the top of what it holds', () => {
    const rows = rowsOf([group('g', [text('a'), text('b')])])
    expect(dropTargetFor(rows[0], 'inside')).toEqual({ parentPath: [0], index: 2 })
  })

  it('has no inside for something that cannot hold anything', () => {
    const rows = rowsOf([text('a')])
    expect(dropTargetFor(rows[0], 'inside')).toBeNull()
  })
})
