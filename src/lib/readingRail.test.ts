import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { buildLabelRows, type LabelRow } from '@/lib/labelRows'
import { laneOffset, railMarks, railWidth } from '@/lib/readingRail'
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

/** One page, given as the ids it holds and the lines drawn across it. */
function page(ids: string, drawn: string[] = []): LabelRow[] {
  const order = ids.split(' ')
  const layers: LayerEntry[] = order.map(text)
  const file: ProjectFile = {
    pageId: '001.png',
    pageDir: '/p/001.png',
    badge: 'ok',
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: order,
      readingEdges: drawn.map((pair) => {
        const [from, to] = pair.split('>')
        return { from, to }
      }),
      layers,
    },
  }
  return buildLabelRows([file]).filter((row): row is LabelRow => row.kind === 'label')
}

describe('railWidth', () => {
  it('takes up no room at all on a page with no lines', () => {
    expect(railWidth(page('a b c'))).toBe(0)
  })

  it('is one lane wide for a plain chain', () => {
    expect(railWidth(page('a b', ['a>b']))).toBe(laneOffset(0) + 8)
  })

  it('grows for a branch alongside the reading', () => {
    expect(railWidth(page('a b c', ['a>b', 'a>c']))).toBe(laneOffset(1) + 8)
  })
})

describe('railMarks', () => {
  it('draws nothing beside a row no line touches', () => {
    const marks = railMarks(page('a b'))
    expect(marks.map((mark) => mark.dot)).toEqual([undefined, undefined])
  })

  it('runs a line out of the first dot and into the last', () => {
    const [first, last] = railMarks(page('a b', ['a>b']))
    expect(first).toMatchObject({ arrives: undefined, leaves: laneOffset(0), joins: [] })
    expect(last).toMatchObject({ arrives: laneOffset(0), leaves: undefined, joins: [] })
  })

  it('carries the reading past a branch rather than breaking off', () => {
    const rows = page('a b c d', ['a>b', 'b>c', 'a>d'])
    expect(rows.map((row) => row.label.id)).toEqual(['a', 'd', 'b', 'c'])
    const [, branch, back] = railMarks(rows)
    // The branch sits in its own lane, joined from the lane the reading runs
    // down — which keeps running past it, so that lane is drawn through as well.
    expect(branch.dot).toBe(laneOffset(1))
    expect(branch.joins).toEqual([[laneOffset(0), laneOffset(1)]])
    expect(branch.through).toEqual([laneOffset(0)])
    expect(branch.stops).toBe(laneOffset(1))
    expect(back).toMatchObject({ dot: laneOffset(0), joins: [] })
  })

  it('leaves the reading lane unmarked where nothing has ended', () => {
    const marks = railMarks(page('a b c', ['a>b', 'b>c']))
    expect(marks.map((mark) => mark.stops)).toEqual([undefined, undefined, undefined])
  })
})
