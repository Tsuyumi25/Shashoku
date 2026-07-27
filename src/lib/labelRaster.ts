import type { TextStyle } from '@shared/text-style/types'
import { catalogByFamily, catalogLoaded } from './fontCatalog'
import { sampleFor, type Sample } from './fontSampleCache'
import { engineStrokeFor } from './textStyle'

export type LabelRaster = { ok: true; sample: Sample } | { ok: false; reason: string }

/**
 * One label's bitmap. Shared because the frame is sized from what the text
 * actually came out as, and a frame that measured a second rasterization of its
 * own would be a mismatch waiting to happen. Reads module state rather than
 * taking it, so a caller inside a `computed` tracks the catalogue for free;
 * repeat calls land on the sample cache.
 *
 * A family that is not in the catalogue is reported, never quietly stood in
 * for. Nothing in this pipeline consults a second face, so drawing one would
 * show a result the application cannot produce (see ADR 0001).
 */
export function rasterFor(text: string, style: TextStyle): LabelRaster {
  if (text.length === 0) return { ok: false, reason: '' }

  const entry = catalogByFamily.value.get(style.fontFamily)
  if (!entry) {
    // Nothing to say while the catalogue is still being enumerated: the family
    // is not missing yet, it is unanswered.
    if (!catalogLoaded.value) return { ok: false, reason: '' }
    return { ok: false, reason: `找不到字型「${style.fontFamily}」` }
  }

  try {
    return {
      ok: true,
      sample: sampleFor({
        entry,
        text,
        sizePx: style.fontSizePx * style.renderScale,
        fillColor: style.color,
        stroke: engineStrokeFor(style),
        vertical: style.direction === 'vertical',
      }),
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
