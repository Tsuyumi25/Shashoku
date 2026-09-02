import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { buildLabelRows, chapterStops, dropAt, type LabelRow } from '@/lib/labelRows'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { OCR_SCHEMA_VERSION } from '@shared/page/types'
import { blankBlock } from '@shared/page/schema'

function text(id: string): TextLayerEntry {
  const entry = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  entry.body.lines = [id]
  return entry
}

function sourceText(id: string): TextLayerEntry {
  const entry = blankBlock(`${id}s`, 'source', DEFAULT_TEXT_STYLE)
  entry.body.lines = [`${id}原`]
  return entry
}

/**
 * ⭐ Given as ids, and each becomes an ordinary translation: one block a side,
 * which is what the list has always drawn as one row.
 */
function file(
  pageId: string,
  ids: string[],
  readingOrder: string[],
  drawn: string[] = [],
): ProjectFile {
  const layers: LayerEntry[] = ids.flatMap((id) => [text(id), sourceText(id)])
  const translationUnits = ids.map((id) => ({
    id,
    tags: [],
    source: { members: [`${id}s`], separators: [] },
    translation: { members: [id], separators: [] },
    candidates: [],
    chosen: null,
  }))
  const readingEdges = drawn.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
  return {
    pageId,
    pageDir: `/p/${pageId}`,
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
    badge: 'ok',
    page: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, name: 'p', width: 1200, height: 1700, translationUnits, readingOrder, readingEdges, layers },
  }
}

function labels(rows: ReturnType<typeof buildLabelRows>): LabelRow[] {
  return rows.filter((row): row is LabelRow => row.kind === 'label')
}

describe('buildLabelRows', () => {
  it('has nothing to show for a project with no pages', () => {
    expect(buildLabelRows([], 'translation')).toEqual([])
  })

  it('heads each page and then lists its objects', () => {
    const rows = buildLabelRows([file('001.png', ['a', 'b'], ['a', 'b'])], 'translation')
    expect(rows.map((r) => r.kind)).toEqual(['page', 'label', 'label'])
    expect(rows[0]).toMatchObject({ kind: 'page', pageId: '001.png', count: 2 })
  })

  it('numbers within the page, so each page starts at one', () => {
    const rows = buildLabelRows([
      file('001.png', ['a', 'b'], ['a', 'b']),
      file('002.png', ['c'], ['c']),
    ], 'translation')
    expect(rows.filter((r) => r.kind === 'label').map((r) => [r.pageId, r.index])).toEqual([
      ['001.png', 1],
      ['001.png', 2],
      ['002.png', 1],
    ])
  })

  it('follows the reading order rather than the tree', () => {
    const rows = buildLabelRows([file('001.png', ['a', 'b'], ['b', 'a'])], 'translation')
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.unit.id)).toEqual(['b', 'a'])
  })

  // A page with nothing on it is exactly what someone proofreading is looking
  // for, so it keeps its heading rather than vanishing from the list.
  it('keeps a page that has no text on it', () => {
    const rows = buildLabelRows([file('001.png', [], []), file('002.png', ['a'], ['a'])], 'translation')
    expect(rows.map((r) => r.kind)).toEqual(['page', 'page', 'label'])
    expect(rows[0]).toMatchObject({ count: 0 })
  })

  it('tells apart objects on different pages that answer to the same id', () => {
    const rows = buildLabelRows([
      file('001.png', ['a'], ['a']),
      file('002.png', ['a'], ['a']),
    ], 'translation')
    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves the gutter blank while no line touches the object', () => {
    const rows = labels(buildLabelRows([file('001.png', ['a', 'b'], ['a', 'b'])], 'translation'))
    expect(rows.map((row) => row.depth)).toEqual([undefined, undefined])
    expect(rows.map((row) => row.lane)).toEqual([undefined, undefined])
  })

  it('draws the objects a line touches up above the ones it does not', () => {
    const rows = labels(
      buildLabelRows([
        file('001.png', ['a', 'b', 'c'], ['a', 'b', 'c'], ['c>b']),
      ], 'translation'),
    )
    expect(rows.map((row) => row.unit.id)).toEqual(['c', 'b', 'a'])
    expect(rows.map((row) => row.depth)).toEqual([1, 2, undefined])
  })

  it('lifts each page from its own lines', () => {
    const rows = labels(
      buildLabelRows([
        file('001.png', ['a', 'b'], ['a', 'b'], ['b>a']),
        file('002.png', ['c', 'd'], ['c', 'd']),
      ], 'translation'),
    )
    expect(rows.map((row) => [row.pageId, row.unit.id])).toEqual([
      ['001.png', 'b'],
      ['001.png', 'a'],
      ['002.png', 'c'],
      ['002.png', 'd'],
    ])
  })

  /**
   * The row is no longer sitting where the reading order puts it, and a drop is
   * still against the reading order — so the two have to stay told apart.
   */
  it('keeps the place in the reading order even after the lines move the row', () => {
    const rows = labels(
      buildLabelRows([file('001.png', ['a', 'b'], ['a', 'b'], ['b>a'])], 'translation'),
    )
    expect(rows.map((row) => [row.unit.id, row.index])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
    expect(dropAt(rows[0], true)).toEqual({ page: '001.png', index: 2 })
  })
})

describe('dropAt', () => {
  const chapter = [
    file('001.png', ['a', 'b'], ['a', 'b']),
    file('002.png', [], []),
  ]

  it('reads a drop on the top half of a row as that row place', () => {
    const rows = buildLabelRows(chapter, 'translation')
    const b = rows.find((r) => r.kind === 'label' && r.unit.id === 'b')
    expect(dropAt(b!, false)).toEqual({ page: '001.png', index: 1 })
  })

  it('reads a drop on the bottom half of a row as the place after it', () => {
    const rows = buildLabelRows(chapter, 'translation')
    const b = rows.find((r) => r.kind === 'label' && r.unit.id === 'b')
    expect(dropAt(b!, true)).toEqual({ page: '001.png', index: 2 })
  })

  it('reads a drop above the first row as the head of its page', () => {
    const rows = buildLabelRows(chapter, 'translation')
    const a = rows.find((r) => r.kind === 'label' && r.unit.id === 'a')
    expect(dropAt(a!, false)).toEqual({ page: '001.png', index: 0 })
  })

  /** A page with nothing on it has only its heading to aim at. */
  it('reads a drop on a heading as the head of that page, either half', () => {
    const rows = buildLabelRows(chapter, 'translation')
    const empty = rows.find((r) => r.kind === 'page' && r.pageId === '002.png')
    expect(dropAt(empty!, false)).toEqual({ page: '002.png', index: 0 })
    expect(dropAt(empty!, true)).toEqual({ page: '002.png', index: 0 })
  })
})

describe('buildLabelRows filtered', () => {
  const chapter = [
    file('001.png', ['a', 'b'], ['a', 'b']),
    file('002.png', ['c'], ['c']),
  ]

  function withText(name: string, lines: Record<string, string[]>): ProjectFile {
    const ids = Object.keys(lines)
    return {
      pageId: name,
      pageDir: `/p/${name}`,
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      badge: 'ok',
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        translationUnits: ids.map((id) => ({
          id,
          tags: [],
          source: { members: [`${id}s`], separators: [] },
          translation: { members: [id], separators: [] },
          candidates: [],
          chosen: null,
        })),
        readingOrder: ids,
        readingEdges: [],
        layers: ids.flatMap((id) => {
          const entry = text(id)
          entry.body.lines = lines[id]
          return [entry, sourceText(id)]
        }),
      },
    }
  }

  it('shows everything when nothing is being looked for', () => {
    expect(buildLabelRows(chapter, 'translation', '')).toEqual(buildLabelRows(chapter, 'translation'))
  })

  it('keeps only the objects that match', () => {
    const rows = buildLabelRows(
      [withText('001.png', { a: ['そうか'], b: ['やめろ'], c: ['そうだね'] })],
      'translation',
      'そう',
      )
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.unit.id)).toEqual(['a', 'c'])
  })

  /** A page with no match is not a page with an empty result — it is not there. */
  it('drops a page nothing on it matches', () => {
    const rows = buildLabelRows(
      [withText('001.png', { a: ['そうか'] }), withText('002.png', { b: ['やめろ'] })],
      'translation',
      'そう',
      )
    expect(rows.filter((r) => r.kind === 'page').map((r) => r.pageId)).toEqual(['001.png'])
  })

  /**
   * The number is the object's place on its page, which is what the canvas
   * writes on it — filtering hides rows, it does not renumber the page.
   */
  it('keeps each object its own number', () => {
    const rows = buildLabelRows(
      [withText('001.png', { a: ['ゆく'], b: ['そう'], c: ['まて'], d: ['そうだ'] })],
      'translation',
      'そう',
      )
    expect(rows.filter((r) => r.kind === 'label').map((r) => [r.unit.id, r.index])).toEqual([
      ['b', 2],
      ['d', 4],
    ])
  })

  it('ignores case, and the spaces around what was typed', () => {
    const rows = buildLabelRows([withText('001.png', { a: ['Hello'], b: ['bye'] })], 'translation', '  HEL ')
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.unit.id)).toEqual(['a'])
  })

  it('looks across the lines of one object, not only the first', () => {
    const rows = buildLabelRows([withText('001.png', { a: ['one', 'two'] })], 'translation', 'two')
    expect(rows.filter((r) => r.kind === 'label')).toHaveLength(1)
  })

  /**
   * 🐛 The state MCP leaves behind when it fills the slot of a blank object:
   * the body's own lines are still empty and what it reads as lives in the
   * slot. A search reading `lines` straight would find nothing while the canvas
   * shows the words.
   */
  it('finds a translation through the candidate it is reading', () => {
    const page = withText('001.png', { a: [''] })
    const unit = page.page.translationUnits[0]
    unit.candidates = [{ id: 'c1', pieces: [['そうだね']] }]
    unit.chosen = 'c1'
    expect(
      buildLabelRows([page], 'translation', 'そう').filter((r) => r.kind === 'label'),
    ).toHaveLength(1)
  })
})

describe('chapterStops', () => {
  it('walks the objects, not the headings', () => {
    const rows = buildLabelRows([
      file('001.png', ['a', 'b'], ['a', 'b']),
      file('002.png', ['c'], ['c']),
    ], 'translation')
    expect(chapterStops(rows).map((r) => (r.kind === 'label' ? r.unit.id : r.pageId))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  /**
   * Except where there are none. A page with nothing on it is somewhere the
   * cursor can be, and its heading is the only thing there to stand on.
   */
  it('stops on the heading of a page with nothing on it', () => {
    const rows = buildLabelRows([
      file('001.png', ['a'], ['a']),
      file('002.png', [], []),
      file('003.png', ['c'], ['c']),
    ], 'translation')
    expect(chapterStops(rows).map((r) => (r.kind === 'label' ? r.unit.id : r.pageId))).toEqual([
      'a',
      '002.png',
      'c',
    ])
  })
})
