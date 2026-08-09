import type { ProjectFile } from '@/types/project'
import type { TextLayerEntry } from '@shared/page/types'
import { textObjectsInReadingOrder } from '@shared/page/tree'
import { flattenReading } from '@shared/page/readingGraph'
import { textOf } from '@shared/page/text'

export interface PageRow {
  kind: 'page'
  key: string
  pageId: string
  count: number
}

export interface LabelRow {
  kind: 'label'
  key: string
  pageId: string
  label: TextLayerEntry
  /**
   * Its place in this page's reading order — where a drop lands, not what is
   * shown. Since the rows are laid out from the lines, this is no longer the
   * position the row is sitting at.
   */
  index: number
  /** The beat, absent while no line touches the object: the gutter stays blank. */
  depth: number | undefined
  /** Which column of the rail the dot stands in, absent for the same reason. */
  lane: number | undefined
  /** The objects a line arrives from, for the rail to draw what joins where. */
  parents: readonly string[]
  /** The lanes still carrying a line downwards once this row has been drawn. */
  carries: readonly number[]
}

export type ChapterRow = PageRow | LabelRow

/**
 * The whole chapter as one list, because proofreading and translating are read
 * at the scale of the chapter rather than the page. Pages keep their headings
 * even when empty — a page with nothing on it is what someone checking for
 * missed text is looking for.
 *
 * Ids are unique within a page and no further, so a row's key carries the page
 * it came from.
 *
 * ⚠️ Each page is laid out from its own lines, so the objects a line touches
 * rise to the head of that page and the rest keep the order they were typed in.
 * That is one rule and not two sections: nothing here marks a boundary, because
 * the rail stopping is the boundary.
 */
export function buildLabelRows(files: readonly ProjectFile[], query = ''): ChapterRow[] {
  const needle = query.trim().toLowerCase()
  const rows: ChapterRow[] = []
  for (const file of files) {
    const inOrder = textObjectsInReadingOrder(file.page)
    const byId = new Map(inOrder.map((label) => [label.id, label]))
    const numbering = new Map(inOrder.map((label, at) => [label.id, at + 1]))

    const laid = flattenReading(file.page.readingEdges, file.page.readingOrder)
    const all = laid.flatMap((row) => {
      const label = byId.get(row.id)
      return label === undefined ? [] : [{ ...row, label }]
    })
    const shown =
      needle === '' ? all : all.filter((row) => textOf(row.label).toLowerCase().includes(needle))
    // A page nothing matches on is not a page with an empty result. It is not
    // one of the places the answer is, so it is not one of the places shown.
    if (needle !== '' && shown.length === 0) continue

    rows.push({
      kind: 'page',
      key: `page/${file.pageId}`,
      pageId: file.pageId,
      count: shown.length,
    })
    for (const row of shown) {
      rows.push({
        kind: 'label',
        key: `label/${file.pageId}/${row.label.id}`,
        pageId: file.pageId,
        label: row.label,
        // Filtering hides rows; it does not renumber the page or move anything.
        index: numbering.get(row.label.id) ?? 0,
        depth: row.depth,
        lane: row.lane,
        parents: row.parents,
        carries: row.carries,
      })
    }
  }
  return rows
}


/**
 * The places moving up or down comes to rest, in the order they are shown.
 *
 * Headings are passed over, since an object is what a step between objects
 * lands on — except on a page that has none, where the heading is the only
 * thing there to stand on and skipping it would make an empty page unreachable.
 */
export function chapterStops(rows: readonly ChapterRow[]): ChapterRow[] {
  const stops: ChapterRow[] = []
  for (const row of rows) {
    if (row.kind === 'label') stops.push(row)
    else if (row.count === 0) stops.push(row)
  }
  return stops
}


/** A place in one page's reading order, counted before the move is applied. */
export interface ReadingOrderDrop {
  page: string
  index: number
}

/**
 * Where a dragged object has come to rest, from the row it was dropped onto and
 * which half of it the pointer was in.
 *
 * A heading takes anything dropped on it to the head of its page — the only way
 * onto a page with nothing on it, which is exactly the page most likely to be
 * missing an object.
 *
 * The index is against the order as it stood, still counting the object being
 * moved, which is what `moveObjectsTo` takes: it knows what is leaving from
 * above the target and subtracts it there.
 */
export function dropAt(row: ChapterRow, after: boolean): ReadingOrderDrop {
  if (row.kind === 'page') return { page: row.pageId, index: 0 }
  return { page: row.pageId, index: after ? row.index : row.index - 1 }
}
