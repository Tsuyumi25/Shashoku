/**
 * A selection in a run of text, named by its ends rather than its order: where
 * it was started from and where it is now, which is where the caret stands.
 * Dragged backwards, `focus` is the smaller of the two.
 *
 * Named so because "start" and "end" read as an order nothing guarantees, and
 * every reader that took them for one had a selection made backwards go wrong.
 * Anything that acts on the words asks `spanOf` for them.
 */
export interface TextSelection {
  anchor: number
  focus: number
}

/** The stretch a selection covers, smaller offset first. */
export function spanOf(at: TextSelection): { from: number; to: number } {
  return at.anchor <= at.focus
    ? { from: at.anchor, to: at.focus }
    : { from: at.focus, to: at.anchor }
}

export function isCollapsed(at: TextSelection): boolean {
  return at.anchor === at.focus
}
