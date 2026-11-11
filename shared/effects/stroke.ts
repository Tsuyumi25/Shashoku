import type { EngineStrokeSpec } from '../engine/types'
import type { LayerEffect, StrokeEffect } from './types'

/**
 * At most one per node. A second stroke would have nowhere to sit that the
 * first does not already occupy, and the interface offers no order to put them
 * in — so the list holds one and the rest of the array is for effects that are
 * not strokes.
 */
export function strokeOf(effects: readonly LayerEffect[]): StrokeEffect | null {
  return effects.find((e) => e.kind === 'stroke') ?? null
}

/**
 * The stroke as it shows: one turned down to no width is held for its colour
 * and position, and draws as nothing — so anything counting looks counts it
 * with the objects that have none.
 */
export function visibleStrokeOf(effects: readonly LayerEffect[]): StrokeEffect | null {
  const stroke = strokeOf(effects)
  return stroke && stroke.width > 0 ? stroke : null
}

/**
 * For each text object, the ones under it whose letters its stroke stays off:
 * both carry a visible stroke of one colour and neither has let go of joining.
 * `ordered` is drawing order, bottom first.
 *
 * Widths and positions are not compared. A band over a band of its own colour
 * cannot be seen whatever their widths, so a band crossing a letter is all
 * there is to keep apart.
 */
export function joinedBelow<T extends { id: string }>(
  ordered: readonly T[],
  effectsOf: (item: T) => readonly LayerEffect[],
): Map<string, T[]> {
  const byColor = new Map<string, T[]>()
  const out = new Map<string, T[]>()
  for (const item of ordered) {
    const stroke = visibleStrokeOf(effectsOf(item))
    if (stroke === null || stroke.joins === false) continue
    const color = stroke.color.toLowerCase()
    const below = byColor.get(color)
    if (below === undefined) {
      byColor.set(color, [item])
      continue
    }
    out.set(item.id, [...below])
    below.push(item)
  }
  return out
}

function specOf(stroke: StrokeEffect): EngineStrokeSpec {
  return { width: stroke.width, color: stroke.color, position: stroke.position }
}

/** Every stroke, in the order they are applied. */
export function engineStrokesFor(effects: readonly LayerEffect[]): EngineStrokeSpec[] {
  return effects.filter((e) => e.kind === 'stroke').map(specOf)
}

/**
 * The list with its stroke replaced, or taken out. Everything that is not a
 * stroke keeps its place, so turning the stroke off cannot quietly drop a
 * neighbour.
 */
export function withStroke(
  effects: readonly LayerEffect[],
  stroke: StrokeEffect | null,
): LayerEffect[] {
  const others = effects.filter((e) => e.kind !== 'stroke')
  return stroke === null ? others : [stroke, ...others]
}
