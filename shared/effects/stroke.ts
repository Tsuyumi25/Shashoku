import type { EngineStrokeSpec } from '../engine/types'
import type { LayerEffect, StrokeEffect } from './types'

/** The strokes, innermost first: each is grown from the edge of the ones before it. */
export function strokesOf(effects: readonly LayerEffect[]): StrokeEffect[] {
  return effects.filter((e): e is StrokeEffect => e.kind === 'stroke')
}

/**
 * The innermost stroke, the one that sits against the letters — which is the
 * one joining reads, since it is the band that would cross another's letters.
 */
export function strokeOf(effects: readonly LayerEffect[]): StrokeEffect | null {
  return strokesOf(effects)[0] ?? null
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
  return strokesOf(effects).map(specOf)
}

/**
 * The list with its strokes replaced. Everything that is not a stroke keeps
 * its place, so taking the strokes off cannot quietly drop a neighbour.
 */
export function withStrokes(
  effects: readonly LayerEffect[],
  strokes: readonly StrokeEffect[],
): LayerEffect[] {
  return [...strokes, ...effects.filter((e) => e.kind !== 'stroke')]
}
