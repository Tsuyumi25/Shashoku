import type { ProjectFile } from '@/types/project'
import type { TextLayerEntry } from '@shared/page/types'
import { textObjectsInReadingOrder } from '@shared/page/tree'
import { textOf } from '@shared/page/text'
import type { DropZone } from '@/lib/rowDrop'

export interface PageRow {
  kind: 'page'
  key: string
  filename: string
  count: number
}

export interface LabelRow {
  kind: 'label'
  key: string
  filename: string
  label: TextLayerEntry
  /** Its place in this page's reading order, which is the number on the canvas. */
  index: number
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
 */
export function buildLabelRows(files: readonly ProjectFile[], query = ''): ChapterRow[] {
  const needle = query.trim().toLowerCase()
  const rows: ChapterRow[] = []
  for (const file of files) {
    const all = textObjectsInReadingOrder(file.page)
    const shown = needle === '' ? all : all.filter((l) => textOf(l).toLowerCase().includes(needle))
    // A page nothing matches on is not a page with an empty result. It is not
    // one of the places the answer is, so it is not one of the places shown.
    if (needle !== '' && shown.length === 0) continue

    const numbering = new Map(all.map((l, i) => [l.id, i + 1]))
    rows.push({
      kind: 'page',
      key: `page/${file.filename}`,
      filename: file.filename,
      count: shown.length,
    })
    for (const label of shown) {
      rows.push({
        kind: 'label',
        key: `label/${file.filename}/${label.id}`,
        filename: file.filename,
        label,
        // Its place on its page, which is what the canvas writes on it.
        // Filtering hides rows; it does not renumber the page.
        index: numbering.get(label.id) ?? 0,
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
 * What a drop on a row of the label list means.
 *
 * The mirror image of the layer tree: this list is not reversed, so above a row
 * on screen is before it in the order, and no correction is needed to translate
 * between the two.
 *
 * A heading takes anything dropped on it to the head of its page. That is the
 * only way onto a page with nothing on it — which is exactly the page most
 * likely to be missing an object.
 */
export function dropIntoReadingOrder(row: ChapterRow, zone: DropZone): ReadingOrderDrop {
  if (row.kind === 'page') return { page: row.filename, index: 0 }
  return { page: row.filename, index: zone === 'below' ? row.index : row.index - 1 }
}
