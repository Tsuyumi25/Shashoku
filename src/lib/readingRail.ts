import type { LabelRow } from './labelRows'

/**
 * Where the rail's strokes fall for one row.
 *
 * Offsets are across the rail, in pixels, so a row draws itself without asking
 * how tall it or anything above it turned out to be — the translation decides
 * that, and the rail has to follow it rather than the other way round.
 */
export interface RailMark {
  /** Lanes carrying a line straight past this row. */
  through: number[]
  /** A line down from the top edge to the dot, when it comes from the same lane. */
  arrives: number | undefined
  /** A line on from the dot to the bottom edge. */
  leaves: number | undefined
  /** Lines curving in from another lane: from the top edge at one offset, to the dot. */
  joins: [number, number][]
  /** Where the dot stands. Absent for a row no line touches, which draws nothing. */
  dot: number | undefined
  /** The stroke across a branch that ends here rather than rejoining. */
  stops: number | undefined
}

const LANE = 12
const EDGE = 8

/**
 * How thick a line on the rail is drawn.
 *
 * Exported because every offset here names the middle of a stroke, and a box
 * placed by its left edge has to be pulled back by half of this to sit on that
 * middle — which is the one thing a dot placed by its centre does not have to
 * do, and where the two disagreed the rail came out a hair out of true.
 */
export const RAIL_STROKE = 1.5

export function laneOffset(lane: number): number {
  return EDGE + LANE * lane
}

/** Nothing at all while no line has been drawn: the column is not there to take up room. */
export function railWidth(rows: readonly LabelRow[]): number {
  let widest = -1
  for (const row of rows) {
    if (row.lane !== undefined && row.lane > widest) widest = row.lane
    for (const lane of row.carries) if (lane > widest) widest = lane
  }
  return widest < 0 ? 0 : laneOffset(widest) + EDGE
}

/**
 * What each row draws, from the difference between the lanes carrying a line
 * into it and the lanes carrying one out.
 *
 * A lane on both sides runs straight past. A lane that stops here is one of this
 * row's own lines arriving, so it is drawn as a join rather than as a stub left
 * hanging. A lane that starts here is this row's own, on its way down.
 */
export function railMarks(rows: readonly LabelRow[]): RailMark[] {
  const laneOf = new Map<string, number>()
  for (const row of rows) if (row.lane !== undefined) laneOf.set(row.label.id, row.lane)

  const marks: RailMark[] = []
  let above: readonly number[] = []
  for (const row of rows) {
    const below = row.carries
    if (row.lane === undefined) {
      marks.push({ through: [], arrives: undefined, leaves: undefined, joins: [], dot: undefined, stops: undefined })
      above = below
      continue
    }

    const mark: RailMark = {
      through: above.filter((lane) => lane !== row.lane && below.includes(lane)).map(laneOffset),
      arrives: above.includes(row.lane) ? laneOffset(row.lane) : undefined,
      leaves: below.includes(row.lane) ? laneOffset(row.lane) : undefined,
      joins: [],
      dot: laneOffset(row.lane),
      stops: undefined,
    }

    // A line from another lane is drawn as well as, not instead of, that lane
    // running past: the curve leaves the straight line where they part.
    for (const parent of row.parents) {
      const from = laneOf.get(parent)
      if (from === undefined || from === row.lane) continue
      mark.joins.push([laneOffset(from), laneOffset(row.lane)])
    }

    // A branch that neither carries on nor is joined further down has come to an
    // end, and saying so is what keeps it from reading as a line that got lost.
    if (row.lane !== 0 && mark.leaves === undefined) mark.stops = laneOffset(row.lane)

    marks.push(mark)
    above = below
  }
  return marks
}
