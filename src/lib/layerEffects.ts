import type { LayerEffect } from '@shared/effects/types'
import type { EngineStrokeSpec } from '@shared/engine/types'
import { engineStrokesFor } from '@shared/effects/stroke'

/** A rectangle on the page, which is what a raster layer occupies. */
export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A layer's pixels with its effects composed onto them, and the bigger
 * rectangle they now occupy.
 *
 * A picture rather than a change to the layer: what a stroke is grown from is
 * the layer's own alpha, and that alpha is the same before and after. Turning
 * the stroke off gives the layer back byte for byte because nothing ever wrote
 * to it.
 */
export interface EffectedLayer {
  canvas: OffscreenCanvas
  frame: Frame
}

/**
 * Blank margin the bands need around the content, in page pixels.
 *
 * Summed rather than maximised: each effect grows from what the ones before it
 * left, so two three-wide strokes reach six. The extra pixel is for the outer
 * band's own soft edge, which sits half in and half out of the last whole pixel
 * the offset names.
 */
export function effectMargin(strokes: readonly EngineStrokeSpec[]): number {
  if (strokes.length === 0) return 0
  return strokes.reduce((sum, s) => sum + Math.ceil(Math.max(0, s.width)), 0) + 1
}

/**
 * One layer as it is drawn once its effects are on, or null when there is
 * nothing for them to do.
 *
 * Null rather than a copy of the source in the ordinary case, so a page of
 * plain layers costs nothing and the caller keeps drawing the bitmap it already
 * has. A layer with no frame yet is null too: a band is grown from content, and
 * there is none — which is what "a stroke on a blank layer draws nothing"
 * means, rather than a case anybody has to guard against.
 *
 * Composited at draw time, so this is the answer for the canvas, the export and
 * the thumbnail alike — and going through the engine is what keeps it the same
 * band a text object gets rather than a second implementation of one.
 */
export function layerWithEffects(
  source: CanvasImageSource,
  frame: Frame,
  effects: readonly LayerEffect[],
): EffectedLayer | null {
  const strokes = engineStrokesFor(effects)
  if (strokes.length === 0) return null
  if (frame.w <= 0 || frame.h <= 0) return null

  const margin = effectMargin(strokes)
  const w = frame.w + margin * 2
  const h = frame.h + margin * 2

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.drawImage(source, margin, margin, frame.w, frame.h)

  const before = ctx.getImageData(0, 0, w, h)
  const after = window.engine.strokeLayer(
    new Uint8Array(before.data.buffer.slice(0)),
    w,
    h,
    strokes,
  )
  ctx.putImageData(new ImageData(new Uint8ClampedArray(after), w, h), 0, 0)

  return {
    canvas,
    frame: { x: frame.x - margin, y: frame.y - margin, w, h },
  }
}

/** The rectangle a layer occupies once its effects are on. */
export function effectedFrame(frame: Frame, effects: readonly LayerEffect[]): Frame {
  const margin = effectMargin(engineStrokesFor(effects))
  if (margin === 0 || frame.w <= 0 || frame.h <= 0) return frame
  return {
    x: frame.x - margin,
    y: frame.y - margin,
    w: frame.w + margin * 2,
    h: frame.h + margin * 2,
  }
}
