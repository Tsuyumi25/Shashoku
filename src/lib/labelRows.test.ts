import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { buildLabelRows, chapterStops, dropAt, type LabelRow } from '@/lib/labelRows'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { OCR_SCHEMA_VERSION } from '@shared/page/types'

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
    source: { hash: null, by: 'auto' },
    ownSource: '',
    translations: [],
    translation: null,
    style: { ...DEFAULT_TEXT_STYLE },
  }
}

function file(
  pageId: string,
  layers: LayerEntry[],
  readingOrder: string[],
  drawn: string[] = [],
): ProjectFile {
  const readingEdges = drawn.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
  return {
    pageId,
    pageDir: `/p/${pageId}`,
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
    badge: 'ok',
    page: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, name: 'p', width: 1200, height: 1700, readingOrder, readingEdges, layers },
  }
}

function labels(rows: ReturnType<typeof buildLabelRows>): LabelRow[] {
  return rows.filter((row): row is LabelRow => row.kind === 'label')
}

describe('buildLabelRows', () => {
  it('has nothing to show for a project with no pages', () => {
    expect(buildLabelRows([])).toEqual([])
  })

  it('heads each page and then lists its objects', () => {
    const rows = buildLabelRows([file('001.png', [text('a'), text('b')], ['a', 'b'])])
    expect(rows.map((r) => r.kind)).toEqual(['page', 'label', 'label'])
    expect(rows[0]).toMatchObject({ kind: 'page', pageId: '001.png', count: 2 })
  })

  it('numbers within the page, so each page starts at one', () => {
    const rows = buildLabelRows([
      file('001.png', [text('a'), text('b')], ['a', 'b']),
      file('002.png', [text('c')], ['c']),
    ])
    expect(rows.filter((r) => r.kind === 'label').map((r) => [r.pageId, r.index])).toEqual([
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

  it('leaves the gutter blank while no line touches the object', () => {
    const rows = labels(buildLabelRows([file('001.png', [text('a'), text('b')], ['a', 'b'])]))
    expect(rows.map((row) => row.depth)).toEqual([undefined, undefined])
    expect(rows.map((row) => row.lane)).toEqual([undefined, undefined])
  })

  it('draws the objects a line touches up above the ones it does not', () => {
    const rows = labels(
      buildLabelRows([
        file('001.png', [text('a'), text('b'), text('c')], ['a', 'b', 'c'], ['c>b']),
      ]),
    )
    expect(rows.map((row) => row.label.id)).toEqual(['c', 'b', 'a'])
    expect(rows.map((row) => row.depth)).toEqual([1, 2, undefined])
  })

  it('lifts each page from its own lines', () => {
    const rows = labels(
      buildLabelRows([
        file('001.png', [text('a'), text('b')], ['a', 'b'], ['b>a']),
        file('002.png', [text('c'), text('d')], ['c', 'd']),
      ]),
    )
    expect(rows.map((row) => [row.pageId, row.label.id])).toEqual([
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
      buildLabelRows([file('001.png', [text('a'), text('b')], ['a', 'b'], ['b>a'])]),
    )
    expect(rows.map((row) => [row.label.id, row.index])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
    expect(dropAt(rows[0], true)).toEqual({ page: '001.png', index: 2 })
  })
})

describe('dropAt', () => {
  const chapter = [
    file('001.png', [text('a'), text('b')], ['a', 'b']),
    file('002.png', [], []),
  ]

  it('reads a drop on the top half of a row as that row place', () => {
    const rows = buildLabelRows(chapter)
    const b = rows.find((r) => r.kind === 'label' && r.label.id === 'b')
    expect(dropAt(b!, false)).toEqual({ page: '001.png', index: 1 })
  })

  it('reads a drop on the bottom half of a row as the place after it', () => {
    const rows = buildLabelRows(chapter)
    const b = rows.find((r) => r.kind === 'label' && r.label.id === 'b')
    expect(dropAt(b!, true)).toEqual({ page: '001.png', index: 2 })
  })

  it('reads a drop above the first row as the head of its page', () => {
    const rows = buildLabelRows(chapter)
    const a = rows.find((r) => r.kind === 'label' && r.label.id === 'a')
    expect(dropAt(a!, false)).toEqual({ page: '001.png', index: 0 })
  })

  /** A page with nothing on it has only its heading to aim at. */
  it('reads a drop on a heading as the head of that page, either half', () => {
    const rows = buildLabelRows(chapter)
    const empty = rows.find((r) => r.kind === 'page' && r.pageId === '002.png')
    expect(dropAt(empty!, false)).toEqual({ page: '002.png', index: 0 })
    expect(dropAt(empty!, true)).toEqual({ page: '002.png', index: 0 })
  })
})

describe('buildLabelRows filtered', () => {
  const chapter = [
    file('001.png', [text('a'), text('b')], ['a', 'b']),
    file('002.png', [text('c')], ['c']),
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
        readingOrder: ids,
        readingEdges: [],
        layers: ids.map((id) => ({ ...text(id), lines: lines[id] })),
      },
    }
  }

  it('shows everything when nothing is being looked for', () => {
    expect(buildLabelRows(chapter, '')).toEqual(buildLabelRows(chapter))
  })

  it('keeps only the objects that match', () => {
    const rows = buildLabelRows(
      [withText('001.png', { a: ['そうか'], b: ['やめろ'], c: ['そうだね'] })],
      'そう',
    )
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.label.id)).toEqual(['a', 'c'])
  })

  /** A page with no match is not a page with an empty result — it is not there. */
  it('drops a page nothing on it matches', () => {
    const rows = buildLabelRows(
      [withText('001.png', { a: ['そうか'] }), withText('002.png', { b: ['やめろ'] })],
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
      'そう',
    )
    expect(rows.filter((r) => r.kind === 'label').map((r) => [r.label.id, r.index])).toEqual([
      ['b', 2],
      ['d', 4],
    ])
  })

  it('ignores case, and the spaces around what was typed', () => {
    const rows = buildLabelRows([withText('001.png', { a: ['Hello'], b: ['bye'] })], '  HEL ')
    expect(rows.filter((r) => r.kind === 'label').map((r) => r.label.id)).toEqual(['a'])
  })

  it('looks across the lines of one object, not only the first', () => {
    const rows = buildLabelRows([withText('001.png', { a: ['one', 'two'] })], 'two')
    expect(rows.filter((r) => r.kind === 'label')).toHaveLength(1)
  })
})

describe('chapterStops', () => {
  it('walks the objects, not the headings', () => {
    const rows = buildLabelRows([
      file('001.png', [text('a'), text('b')], ['a', 'b']),
      file('002.png', [text('c')], ['c']),
    ])
    expect(chapterStops(rows).map((r) => (r.kind === 'label' ? r.label.id : r.pageId))).toEqual([
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
      file('001.png', [text('a')], ['a']),
      file('002.png', [], []),
      file('003.png', [text('c')], ['c']),
    ])
    expect(chapterStops(rows).map((r) => (r.kind === 'label' ? r.label.id : r.pageId))).toEqual([
      'a',
      '002.png',
      'c',
    ])
  })
})
