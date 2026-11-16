import type { GlowEffect } from '@shared/effects/types'
import { glowReach, glowShape } from '@shared/effects/glow'

/** A halo in page pixels, `margin` bigger than its source on every side. */
export interface GlowPicture {
  canvas: OffscreenCanvas
  margin: number
}

/**
 * The halo of a picture that is already everything the node draws: grown out
 * solid by the spread's share of the size, blurred by the rest, then coloured.
 *
 * The solid part goes through the engine's band, the one every stroke is grown
 * with, so a fully spread halo and an outside stroke of the same width are one
 * shape.
 */
export function glowPicture(
  source: CanvasImageSource,
  width: number,
  height: number,
  glow: GlowEffect,
): GlowPicture | null {
  const margin = glowReach(glow)
  if (margin === 0 || width <= 0 || height <= 0) return null
  const w = width + margin * 2
  const h = height + margin * 2
  const { spread, blur } = glowShape(glow)

  const mask = new OffscreenCanvas(w, h)
  const maskCtx = mask.getContext('2d')
  if (!maskCtx) throw new Error('OffscreenCanvas 2d context unavailable')
  maskCtx.drawImage(source, margin, margin, width, height)
  if (spread > 0) {
    const before = maskCtx.getImageData(0, 0, w, h)
    const grown = window.engine.strokeLayer(new Uint8Array(before.data.buffer.slice(0)), w, h, [
      { width: spread, color: '#000000', position: 'outside' },
    ])
    maskCtx.putImageData(new ImageData(new Uint8ClampedArray(grown), w, h), 0, 0)
  }

  const out = new OffscreenCanvas(w, h)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  // Half the blur as the deviation, the same Gaussian a canvas shadow of that blur is.
  if (blur > 0) ctx.filter = `blur(${blur / 2}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'
  // The colour where the blurred shape is, its alpha times the shape's.
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = glow.color
  ctx.fillRect(0, 0, w, h)
  return { canvas: out, margin }
}

/**
 * `glowPicture`, kept against the source until its size, the halo or `version`
 * changes. A label's bitmap is a cached sample that keeps its identity, so this
 * is what lets a page repaint every frame of a drag without growing every halo
 * again. A canvas written in place keeps its identity too, which is what
 * `version` is for; null asks for a fresh one, kept nowhere.
 */
export function glowPictureHeld(
  source: CanvasImageSource,
  width: number,
  height: number,
  glow: GlowEffect,
  version: number | null = 0,
): GlowPicture | null {
  if (version === null) return glowPicture(source, width, height, glow)
  const key = `${width}x${height}|${glow.size}|${glow.spread}|${glow.color}|${version}`
  const held = heldBySource.get(source)
  if (held?.key === key) return held.picture
  const picture = glowPicture(source, width, height, glow)
  heldBySource.set(source, { key, picture })
  return picture
}

const heldBySource = new WeakMap<CanvasImageSource, { key: string; picture: GlowPicture | null }>()
