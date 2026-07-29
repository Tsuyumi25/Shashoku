/** Which part of a row the pointer is over. */
export type DropZone = 'above' | 'below' | 'inside'

/**
 * Where in a row a drag is aimed.
 *
 * A row that can hold things gets a middle band that files into it, and the
 * bands either side are deliberately narrow: dropping between two rows is the
 * common move and dropping into something is the deliberate one. A row that
 * holds nothing is split down the middle, so there is no way to aim at a
 * meaning it does not have.
 */
export function zoneAt(rect: DOMRect, clientY: number, canHold: boolean): DropZone {
  const ratio = rect.height === 0 ? 0 : (clientY - rect.top) / rect.height
  if (!canHold) return ratio < 0.5 ? 'above' : 'below'
  if (ratio < 0.25) return 'above'
  if (ratio > 0.75) return 'below'
  return 'inside'
}
