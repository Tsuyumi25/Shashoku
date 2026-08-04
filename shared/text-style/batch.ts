import { TEXT_STYLE_FIELDS } from './schema'
import type { TextStyle, TextStyleProvenance } from './types'

/** A style and the note saying where each of its fields came from. */
export interface StyledState {
  style: TextStyle
  provenance: TextStyleProvenance
}

/**
 * Write some fields and say who wrote them. `source` is the label the operation
 * showed the user; `null` means a hand edit, which drops the note rather than
 * writing one — a field somebody touched directly is theirs, and claiming a
 * batch still owns it would make the group-by-value view lie about why a
 * hundred objects agree.
 *
 * Only the fields in `patch` are touched. That is the whole point of the
 * per-field shape: changing everyone's font must not also flatten the sizes
 * somebody set one at a time.
 */
export function applyStylePatch(
  before: StyledState,
  patch: Partial<TextStyle>,
  source: string | null,
): StyledState {
  const style: TextStyle = { ...before.style, ...patch }
  const provenance: TextStyleProvenance = { ...before.provenance }
  for (const field of TEXT_STYLE_FIELDS) {
    if (patch[field] === undefined) continue
    if (source === null) delete provenance[field]
    else provenance[field] = source
  }
  return { style, provenance }
}


/**
 * What a panel shows for one field across a selection: the value when everyone
 * agrees, or the fact that they do not. Never a first-one-wins guess — a panel
 * showing 24 for a selection that also holds 48s would turn a glance into an
 * edit the moment anyone touched the field.
 */
export type SharedValue<T> = { kind: 'one'; value: T } | { kind: 'many' } | { kind: 'none' }

export function sharedValue<K extends keyof TextStyle>(
  styles: readonly TextStyle[],
  field: K,
): SharedValue<TextStyle[K]> {
  if (styles.length === 0) return { kind: 'none' }
  const first = styles[0][field]
  const encoded = JSON.stringify(first)
  for (const style of styles) {
    if (JSON.stringify(style[field]) !== encoded) return { kind: 'many' }
  }
  return { kind: 'one', value: first }
}

/**
 * How many of a bunch of objects carry a batch's mark on a given field, and
 * which batch. Used to say "12 of these were written by 換字體" without
 * letting that fact take part in deciding what a bunch *is*.
 */
export function provenanceTally(
  states: readonly TextStyleProvenance[],
  field: keyof TextStyle,
): Map<string, number> {
  const tally = new Map<string, number>()
  for (const provenance of states) {
    const label = provenance[field]
    if (label === undefined) continue
    tally.set(label, (tally.get(label) ?? 0) + 1)
  }
  return tally
}
