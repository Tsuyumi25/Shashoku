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

function specOf(stroke: StrokeEffect): EngineStrokeSpec {
  return { width: stroke.width, color: stroke.color, position: stroke.position }
}

/**
 * The stroke as the engine's text calls take it — one, because those paint a
 * run in a single pass and take a single stroke. A text object carrying two
 * therefore shows the first; the layer path below honours the whole list, since
 * its call composes them one after another.
 */
export function engineStrokeFor(effects: readonly LayerEffect[]): EngineStrokeSpec | undefined {
  const stroke = strokeOf(effects)
  return stroke ? specOf(stroke) : undefined
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
