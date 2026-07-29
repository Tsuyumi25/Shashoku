import type { ProjectFile } from '@/types/project'
import type { TextLayerEntry } from '@shared/page/types'
import { textObjectsInReadingOrder } from '@shared/page/tree'

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
export function buildLabelRows(files: readonly ProjectFile[]): ChapterRow[] {
  const rows: ChapterRow[] = []
  for (const file of files) {
    const labels = textObjectsInReadingOrder(file.page)
    rows.push({ kind: 'page', key: `page/${file.filename}`, filename: file.filename, count: labels.length })
    labels.forEach((label, i) => {
      rows.push({
        kind: 'label',
        key: `label/${file.filename}/${label.id}`,
        filename: file.filename,
        label,
        index: i + 1,
      })
    })
  }
  return rows
}
