import type { GlowEffect, LayerEffect, ToneEffect } from '@shared/effects/types'
import type { EngineStrokeSpec } from '@shared/engine/types'
import { glowOf, glowReach } from '@shared/effects/glow'
import { engineStrokesFor } from '@shared/effects/stroke'
import { toneOf, withTone } from '@shared/effects/tone'
import { glowPictureHeld } from '@/lib/glowPicture'
import { tonePicture } from '@/lib/tonePicture'

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

/** The strokes' margin and then the halo's, which blurs out of what they left. */
function marginFor(effects: readonly LayerEffect[]): number {
  return effectMargin(engineStrokesFor(effects)) + glowReach(glowOf(effects))
}

/** Whether anything in the list draws, so a layer carrying it needs a picture of its own. */
export function effectsDraw(effects: readonly LayerEffect[]): boolean {
  return engineStrokesFor(effects).length > 0 || glowReach(glowOf(effects)) > 0 || toneOf(effects) !== null
}

/**
 * One layer as it is drawn once its strokes and its screentone are on, or null
 * when it has neither.
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
 *
 * Screentone comes last, over the strokes too, on the page's grid. The halo is
 * not here: a raster's halo is a stack node of its own, so that its blend mode
 * reaches the page. See `GlowStackNode`.
 */
export function layerWithEffects(
  source: CanvasImageSource,
  frame: Frame,
  effects: readonly LayerEffect[],
): EffectedLayer | null {
  const strokes = engineStrokesFor(effects)
  const tone = toneOf(effects)
  if (strokes.length === 0 && tone === null) return null
  if (frame.w <= 0 || frame.h <= 0) return null

  const margin = effectMargin(strokes)
  const w = frame.w + margin * 2
  const h = frame.h + margin * 2
  const at = { x: frame.x - margin, y: frame.y - margin, w, h }

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.drawImage(source, margin, margin, frame.w, frame.h)

  if (strokes.length > 0) {
    const before = ctx.getImageData(0, 0, w, h)
    const after = window.engine.strokeLayer(
      new Uint8Array(before.data.buffer.slice(0)),
      w,
      h,
      strokes,
    )
    ctx.putImageData(new ImageData(new Uint8ClampedArray(after), w, h), 0, 0)
  }

  const stroked = { canvas, frame: at }
  return tone === null ? stroked : screened(canvas, at, tone)
}

/** A picture already placed on the page, turned into screentone on the page's grid. */
function screened(canvas: CanvasImageSource, frame: Frame, tone: ToneEffect): EffectedLayer {
  const grid = { x0: frame.x + 0.5, y0: frame.y + 0.5, dx: 1, dy: 1 } as const
  return { canvas: tonePicture(canvas, frame.w, frame.h, grid, tone), frame }
}

/**
 * The halo of a picture that sits at `frame` on the page, placed where it lands
 * there. Held against the picture under `version` (see `glowPictureHeld`),
 * which is how a run repainting every frame of a drag gets away with it.
 */
export function glowAt(
  picture: CanvasImageSource,
  frame: Frame,
  glow: GlowEffect,
  version: number | null,
): EffectedLayer | null {
  const halo = glowPictureHeld(picture, frame.w, frame.h, glow, version)
  if (halo === null) return null
  return {
    canvas: halo.canvas,
    frame: {
      x: frame.x - halo.margin,
      y: frame.y - halo.margin,
      w: halo.canvas.width,
      h: halo.canvas.height,
    },
  }
}

/** A layer's picture twice over: with its strokes on, and as drawn. */
export interface HeldLayer {
  /** Before any screentone, which is what a halo grows from; null with no strokes. */
  stroked: EffectedLayer | null
  /** Strokes and screentone on; null when the layer draws its own bitmap. */
  shown: EffectedLayer | null
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
): HeldLayer {
  const key = `${frame.x},${frame.y},${frame.w},${frame.h}|${version}|${JSON.stringify(effects)}`
  const held = effectedBySource.get(source)
  if (held?.key === key) return held.layer
  const stroked = layerWithEffects(source, frame, withTone(effects, null))
  const tone = toneOf(effects)
  const shown =
    tone === null || frame.w <= 0 || frame.h <= 0
      ? stroked
      : screened(stroked?.canvas ?? source, stroked?.frame ?? frame, tone)
  const layer = { stroked, shown }
  effectedBySource.set(source, { key, layer })
  return layer
}

const effectedBySource = new WeakMap<CanvasImageSource, { key: string; layer: HeldLayer }>()

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
  if (!effectsDraw(effects)) return null
  const ctx = picture.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  const { width, height } = picture
  const bounds = alphaBounds(ctx.getImageData(0, 0, width, height).data, width, height)
  if (bounds === null) return null
  const content = new OffscreenCanvas(bounds.w, bounds.h)
  const cut = content.getContext('2d')
  if (!cut) throw new Error('OffscreenCanvas 2d context unavailable')
  cut.drawImage(picture, -bounds.x, -bounds.y)
  const stroked = layerWithEffects(content, bounds, withTone(effects, null)) ?? { canvas: content, frame: bounds }
  const tone = toneOf(effects)
  const shown = tone === null ? stroked : screened(stroked.canvas, stroked.frame, tone)
  const glow = glowOf(effects)
  const halo = glow === null ? null : glowAt(stroked.canvas, stroked.frame, glow, null)
  if (halo === null) return shown

  // A folder is already one picture, so its halo goes inside it and blends as
  // that picture does.
  const lit = new OffscreenCanvas(halo.frame.w, halo.frame.h)
  const litCtx = lit.getContext('2d')
  if (!litCtx) throw new Error('OffscreenCanvas 2d context unavailable')
  litCtx.drawImage(halo.canvas, 0, 0)
  litCtx.drawImage(shown.canvas, shown.frame.x - halo.frame.x, shown.frame.y - halo.frame.y)
  return { canvas: lit, frame: halo.frame }
}

/** The rectangle a layer occupies once its effects are on. */
export function effectedFrame(frame: Frame, effects: readonly LayerEffect[]): Frame {
  const margin = marginFor(effects)
  if (margin === 0 || frame.w <= 0 || frame.h <= 0) return frame
  return {
    x: frame.x - margin,
    y: frame.y - margin,
    w: frame.w + margin * 2,
    h: frame.h + margin * 2,
  }
}
