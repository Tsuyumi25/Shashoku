/**
 * What a panel shows for one field across a selection: the value when everyone
 * agrees, or the fact that they do not. Never a first-one-wins guess — a panel
 * showing 24 for a selection that also holds 48s would turn a glance into an
 * edit the moment anyone touched the field.
 */
export type SharedValue<T> = { kind: 'one'; value: T } | { kind: 'many' } | { kind: 'none' }

/**
 * Deliberately knows nothing about what it is reading. Whether a batch agrees
 * about a field is mechanical and the same question for a font size, an
 * opacity and a list of effects — so the panels that ask it can differ in how
 * they draw the answer without differing in how they arrive at it.
 *
 * Encoded rather than compared, because a field can hold a list.
 */
export function sharedValue<T, K extends keyof T>(items: readonly T[], field: K): SharedValue<T[K]> {
  if (items.length === 0) return { kind: 'none' }
  const first = items[0][field]
  const encoded = JSON.stringify(first)
  for (const item of items) {
    if (JSON.stringify(item[field]) !== encoded) return { kind: 'many' }
  }
  return { kind: 'one', value: first }
}
