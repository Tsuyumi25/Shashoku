import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { buildLabelRows } from '@/lib/labelRows'

function text(id: string): TextLayerEntry {
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
  }
}

function file(filename: string, layers: LayerEntry[], readingOrder: string[]): ProjectFile {
  return {
    filename,
    pageDir: `/p/${filename}`,
    badge: 'ok',
    page: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder, layers },
  }
}

describe('buildLabelRows', () => {
  it('has nothing to show for a project with no pages', () => {
    expect(buildLabelRows([])).toEqual([])
  })

  it('heads each page and then lists its objects', () => {
    const rows = buildLabelRows([file('001.png', [text('a'), text('b')], ['a', 'b'])])
    expect(rows.map((r) => r.kind)).toEqual(['page', 'label', 'label'])
    expect(rows[0]).toMatchObject({ kind: 'page', filename: '001.png', count: 2 })
  })

  it('numbers within the page, so each page starts at one', () => {
    const rows = buildLabelRows([
      file('001.png', [text('a'), text('b')], ['a', 'b']),
      file('002.png', [text('c')], ['c']),
    ])
    expect(rows.filter((r) => r.kind === 'label').map((r) => [r.filename, r.index])).toEqual([
      ['001.png', 1],
      ['001.png', 2],
      ['002.png', 1],
    ])
  })

  it('follows the reading order rather than the tree', () => {
    const rows = buildLabelRows([file('001.png', [text('a'), text('b')], ['b', 'a'])])
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.label.id)).toEqual(['b', 'a'])
  })

  // A page with nothing on it is exactly what someone proofreading is looking
  // for, so it keeps its heading rather than vanishing from the list.
  it('keeps a page that has no text on it', () => {
    const rows = buildLabelRows([file('001.png', [], []), file('002.png', [text('a')], ['a'])])
    expect(rows.map((r) => r.kind)).toEqual(['page', 'page', 'label'])
    expect(rows[0]).toMatchObject({ count: 0 })
  })

  it('tells apart objects on different pages that answer to the same id', () => {
    const rows = buildLabelRows([
      file('001.png', [text('a')], ['a']),
      file('002.png', [text('a')], ['a']),
    ])
    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
