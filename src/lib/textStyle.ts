import type { EngineStrokeSpec } from '@shared/engine/types'
import type { StyleGroup } from '@shared/project/types'
import type { StrokeEffect, TextStyle } from '@shared/text-style/types'

/**
 * The one place the inheritance chain is spelled out: project default, then
 * the label's group, then the label's own override. A group whose id no longer
 * names anything falls through to the default rather than losing its text.
 */
export function resolveTextStyle(
  label: { groupId: string | null; styleOverride?: Partial<TextStyle> },
  groups: readonly StyleGroup[],
  defaultStyle: TextStyle,
): TextStyle {
  const group = label.groupId ? groups.find((g) => g.id === label.groupId) : undefined
  return { ...defaultStyle, ...(group?.style ?? {}), ...(label.styleOverride ?? {}) }
}

export function strokeOf(style: TextStyle): StrokeEffect | null {
  return (style.effects.find((e) => e.kind === 'stroke') as StrokeEffect | undefined) ?? null
}

/**
 * Stroke width is a document measurement, so it has to be scaled alongside the
 * font size the bitmap is rasterized at — otherwise the stroke thins out by
 * exactly renderScale once the bitmap is put back at document size.
 */
export function engineStrokeFor(style: TextStyle): EngineStrokeSpec | undefined {
  const stroke = strokeOf(style)
  if (!stroke) return undefined
  return {
    width: stroke.width * style.renderScale,
    color: stroke.color,
    position: stroke.position,
  }
}
