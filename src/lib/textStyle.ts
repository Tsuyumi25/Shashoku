import type { EngineStrokeSpec } from '@shared/engine/types'
import type { StrokeEffect, TextStyle } from '@shared/text-style/types'

export function strokeOf(style: TextStyle): StrokeEffect | null {
  return (style.effects.find((e) => e.kind === 'stroke') as StrokeEffect | undefined) ?? null
}

export function engineStrokeFor(style: TextStyle): EngineStrokeSpec | undefined {
  const stroke = strokeOf(style)
  if (!stroke) return undefined
  return {
    width: stroke.width,
    color: stroke.color,
    position: stroke.position,
  }
}
