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
 * The stroke as the engine takes it — a plain value, because everything
 * crossing contextBridge has to be structured-cloneable and a list read off a
 * Vue store is a Proxy.
 */
export function engineStrokeFor(effects: readonly LayerEffect[]): EngineStrokeSpec | undefined {
  const stroke = strokeOf(effects)
  if (!stroke) return undefined
  return {
    width: stroke.width,
    color: stroke.color,
    position: stroke.position,
  }
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
