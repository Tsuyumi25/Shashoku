import type { TextStyle } from './types'

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
