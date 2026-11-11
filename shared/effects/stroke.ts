import type { EngineStrokeSpec } from '../engine/types'
import type { LayerEffect, StrokeEffect } from './types'

/** The strokes, innermost first: each is grown from the edge of the ones before it. */
export function strokesOf(effects: readonly LayerEffect[]): StrokeEffect[] {
  return effects.filter((e): e is StrokeEffect => e.kind === 'stroke')
}

/**
 * The outermost stroke that shows — the last with a width and a colour with
 * any alpha — and where it sits in the list. It is the band a neighbour's
 * letters meet, so it is the one joining reads; the strokes inside it stay on
 * their own letters wherever the object is stacked.
 */
export function outerStrokeOf(effects: readonly LayerEffect[]): { stroke: StrokeEffect; at: number } | null {
  for (let at = effects.length - 1; at >= 0; at--) {
    const e = effects[at]!
    if (e.kind === 'stroke' && e.width > 0 && !/^#[0-9a-f]{6}00$/i.test(e.color)) return { stroke: e, at }
  }
  return null
}

/**
 * The list with joining let go of or taken back, on every stroke at once. The
 * outermost is the one read, and which stroke is outermost changes as they
 * are reordered, added or turned down — so the choice is the object's, kept
 * the same on all of them.
 */
export function withJoins(effects: readonly LayerEffect[], joins: boolean): LayerEffect[] {
  return effects.map((e) => {
    if (e.kind !== 'stroke') return e
    const { joins: _was, ...rest } = e
    return joins ? rest : { ...rest, joins: false }
  })
}

/**
 * For each text object, the ones under it whose letters its outermost stroke
 * stays off: both outermost strokes are of one colour and neither object has
 * let go of joining. `ordered` is drawing order, bottom first.
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
    const stroke = outerStrokeOf(effectsOf(item))?.stroke
    if (stroke === undefined || stroke.joins === false) continue
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
