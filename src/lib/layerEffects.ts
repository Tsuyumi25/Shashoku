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

/**
 * `layerWithEffects`, kept against the source it was grown from until the
 * frame, the effects or `version` changes. A canvas written in place keeps its
 * identity, so `version` is what says its pixels moved.
 */
export function layerWithEffectsHeld(
  source: CanvasImageSource,
  frame: Frame,
  effects: readonly LayerEffect[],
  version: number,
): EffectedLayer | null {
  const key = `${frame.x},${frame.y},${frame.w},${frame.h}|${version}|${JSON.stringify(effects)}`
  const held = effectedBySource.get(source)
  if (held?.key === key) return held.effected
  const effected = layerWithEffects(source, frame, effects)
  effectedBySource.set(source, { key, effected })
  return effected
}

const effectedBySource = new WeakMap<CanvasImageSource, { key: string; effected: EffectedLayer | null }>()

/** The smallest rectangle holding every pixel with any alpha, or null when none has. */
export function alphaBounds(rgba: Uint8ClampedArray, width: number, height: number): Frame | null {
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (rgba[(row + x) * 4 + 3] === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      bottom = y
    }
  }
  if (right < 0) return null
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/**
 * A folder's contents, already one picture in page coordinates, with the
 * folder's effects composed onto them — or null when there is nothing for them
 * to do.
 *
 * Cut down to what the contents cover before the band is grown: a distance
 * field costs the whole area it is taken over, and a folder of a few balloons
 * covers a small corner of the page its buffer is sized to.
 */
export function pictureWithEffects(
  picture: OffscreenCanvas,
  effects: readonly LayerEffect[],
): EffectedLayer | null {
  if (engineStrokesFor(effects).length === 0) return null
  const ctx = picture.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  const { width, height } = picture
  const bounds = alphaBounds(ctx.getImageData(0, 0, width, height).data, width, height)
  if (bounds === null) return null
  const content = new OffscreenCanvas(bounds.w, bounds.h)
  const cut = content.getContext('2d')
  if (!cut) throw new Error('OffscreenCanvas 2d context unavailable')
  cut.drawImage(picture, -bounds.x, -bounds.y)
  return layerWithEffects(content, bounds, effects)
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
