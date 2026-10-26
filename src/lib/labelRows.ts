import type { ProjectFile } from '@/types/project'
import type { TextLayerEntry, TranslationUnit } from '@shared/page/types'
import type { TextSide } from '@shared/page/text'
import { flattenReading } from '@shared/page/readingGraph'
import { blocksOf, projectionCodeOf, projectionOf, shownCodeOf, unitsInReadingOrder } from '@shared/page/units'

export interface PageRow {
  kind: 'page'
  key: string
  pageId: string
  /** What the page is called, which is not what it is keyed by. */
  name: string
  count: number
}

/**
 * One translation, whichever side is being shown.
 *
 * It carries the blocks rather than one body, because how many blocks a side was
 * set in is a fact about this row: one is the ordinary case and reads exactly as
 * it always has, and more than one is what the block rows below it are for.
 */
export interface LabelRow {
  kind: 'label'
  key: string
  pageId: string
  unit: TranslationUnit
  /** The blocks of the side being shown, in the order they are read. */
  blocks: readonly TextLayerEntry[]
  /** This side's markup, whole — every block of it with the gaps between — as the list shows and edits it. */
  main: string
  /** The other side's markup, whole — the context a row is checked against. */
  opposite: string
  /**
   * Its place in this page's reading order — where a drop lands, not what is
   * shown. Since the rows are laid out from the lines, this is no longer the
   * position the row is sitting at.
   */
  index: number
  /** The beat, absent while no line touches the unit: the gutter stays blank. */
  depth: number | undefined
  /** Which column of the rail the dot stands in, absent for the same reason. */
  lane: number | undefined
  /** The units a line arrives from, for the rail to draw what joins where. */
  parents: readonly string[]
  /** The lanes still carrying a line downwards once this row has been drawn. */
  carries: readonly number[]
}

/**
 * One block of a translation that was set in more than one.
 *
 * ⭐ Only ever emitted under a row holding several. A translation set in one
 * block is one row, unchanged — the point of the unit is that ordinary work
 * never has to know it is there.
 */
export interface BlockRow {
  kind: 'block'
  key: string
  pageId: string
  unit: TranslationUnit
  block: TextLayerEntry
  /** Which block of this side it is, counting from one, which is what it shows. */
  at: number
  /** This block's markup, chosen candidate resolved. */
  text: string
  /** Where its unit sits in the reading order, so a drop on it lands there. */
  index: number
}

export type ChapterRow = PageRow | LabelRow | BlockRow

/**
 * The whole chapter as one list, because proofreading and translating are read
 * at the scale of the chapter rather than the page. Pages keep their headings
 * even when empty — a page with nothing on it is what someone checking for
 * missed text is looking for.
 *
 * Ids are unique within a page and no further, so a row's key carries the page
 * it came from.
 *
 * ⚠️ Each page is laid out from its own lines, so the units a line touches rise
 * to the head of that page and the rest keep the order they were typed in. That
 * is one rule and not two sections: nothing here marks a boundary, because the
 * rail stopping is the boundary.
 */
export function buildLabelRows(
  files: readonly ProjectFile[],
  side: TextSide,
  query = '',
): ChapterRow[] {
  const needle = query.trim().toLowerCase()
  const other: TextSide = side === 'source' ? 'translation' : 'source'
  const rows: ChapterRow[] = []
  for (const file of files) {
    const inOrder = unitsInReadingOrder(file.page)
    const byId = new Map(inOrder.map((unit) => [unit.id, unit]))
    const numbering = new Map(inOrder.map((unit, at) => [unit.id, at + 1]))

    const laid = flattenReading(file.page.readingEdges, file.page.readingOrder)
    const all = laid.flatMap((row) => {
      const unit = byId.get(row.id)
      return unit === undefined ? [] : [{ ...row, unit }]
    })
    // Searching what the page will say rather than what is on the artwork: the
    // question a search answers is where a line of the translation went, and
    // that is the same question whichever side is open.
    const shown =
      needle === ''
        ? all
        : all.filter((row) =>
            projectionOf(file.page.layers, row.unit, 'translation').toLowerCase().includes(needle),
          )
    // A page nothing matches on is not a page with an empty result. It is not
    // one of the places the answer is, so it is not one of the places shown.
    if (needle !== '' && shown.length === 0) continue

    rows.push({
      kind: 'page',
      key: `page/${file.pageId}`,
      pageId: file.pageId,
      name: file.page.name,
      count: shown.length,
    })
    for (const row of shown) {
      const blocks = blocksOf(file.page.layers, row.unit, side)
      // Filtering hides rows; it does not renumber the page or move anything.
      const index = numbering.get(row.unit.id) ?? 0
      rows.push({
        kind: 'label',
        key: `label/${file.pageId}/${row.unit.id}`,
        pageId: file.pageId,
        unit: row.unit,
        blocks,
        main: projectionCodeOf(file.page.layers, row.unit, side),
        opposite: projectionCodeOf(file.page.layers, row.unit, other),
        index,
        depth: row.depth,
        lane: row.lane,
        parents: row.parents,
        carries: row.carries,
      })
      if (blocks.length < 2) continue
      blocks.forEach((block, at) => {
        rows.push({
          kind: 'block',
          key: `block/${file.pageId}/${block.id}`,
          pageId: file.pageId,
          unit: row.unit,
          block,
          at: at + 1,
          text: shownCodeOf(file.page, block),
          index,
        })
      })
    }
  }
  return rows
}


/**
 * The places moving up or down comes to rest, in the order they are shown.
 *
 * Headings are passed over, since a translation is what a step between
 * translations lands on — except on a page that has none, where the heading is
 * the only thing there to stand on and skipping it would make an empty page
 * unreachable.
 *
 * ⭐ The blocks of one translation are stepped through before the next
 * translation, which is what makes typing a sound split in two one movement
 * rather than a hunt.
 */
export function chapterStops(rows: readonly ChapterRow[]): ChapterRow[] {
  const stops: ChapterRow[] = []
  for (const row of rows) {
    if (row.kind !== 'page') stops.push(row)
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
 * Where a dragged translation has come to rest, from the row it was dropped onto
 * and which half of it the pointer was in.
 *
 * A heading takes anything dropped on it to the head of its page — the only way
 * onto a page with nothing on it, which is exactly the page most likely to be
 * missing a translation.
 *
 * The index is against the order as it stood, still counting the unit being
 * moved, which is what `moveObjectsTo` takes: it knows what is leaving from
 * above the target and subtracts it there.
 */
export function dropAt(row: ChapterRow, after: boolean): ReadingOrderDrop {
  if (row.kind === 'page') return { page: row.pageId, index: 0 }
  return { page: row.pageId, index: after ? row.index : row.index - 1 }
}
