import type { EngineClusterRect, EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { engineSourceFor } from './fontCatalog'

export interface SampleRequest {
  entry: FontEntry
  text: string
  /** Device pixels, so the sample stays crisp on a HiDPI display. */
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Columns running right to left instead of rows. */
  vertical?: boolean
  /**
   * How far into its own pixel the run starts, in bitmap pixels. Part of the
   * identity of the bitmap, so it is part of the key — and why the caller has
   * to round it to something coarse before asking.
   */
  phaseX?: number
  phaseY?: number
}

export interface Sample {
  image: ImageData
  /** Boxes around the characters `entry` has no glyph for, in bitmap pixels. */
  marks: EngineClusterRect[]
  /**
   * Where every cluster landed. The editor overlay answers three questions from
   * this one table: which character a click hit, where to draw the caret, and
   * where the IME should put its candidate window.
   */
  clusters: EngineClusterRect[]
  /** Blank margin the bitmap was drawn with, in bitmap pixels. */
  padding: number
}

/** Roughly 17KB per bitmap at the default sample size. */
const CACHE_LIMIT = 240

/**
 * Blank margin around a sample. An outside stroke grows the glyph past its
 * advance box; without room for it the sample comes back clipped.
 */
export function samplePadding(stroke?: EngineStrokeSpec): number {
  return 4 + Math.ceil(stroke?.width ?? 0)
}

const cache = new Map<string, Sample>()
const coverage = new Map<string, number[]>()

function coverageKey(entry: FontEntry, text: string): string {
  return `${entry.family}|${text}`
}

function keyOf(req: SampleRequest): string {
  const stroke = req.stroke
    ? `${req.stroke.width}/${req.stroke.color}/${req.stroke.position ?? 'outside'}`
    : '-'
  return [
    req.entry.family,
    req.sizePx,
    req.fillColor,
    stroke,
    req.vertical ? 'v' : 'h',
    `${req.phaseX ?? 0},${req.phaseY ?? 0}`,
    req.text,
  ].join('|')
}

/**
 * Byte offsets of the characters this family cannot draw. Reading the cmap of
 * a mapped file is cheap enough to do for a whole catalogue in one pass.
 */
export function coverageFor(entry: FontEntry, text: string): number[] {
  const key = coverageKey(entry, text)
  const held = coverage.get(key)
  if (held) return held

  const uncovered = window.engine.uncoveredClusters(engineSourceFor(entry), text)
  coverage.set(key, uncovered)
  return uncovered
}

function rasterize(req: SampleRequest): Sample {
  const uncovered = coverageFor(req.entry, req.text)
  const drawWith = engineSourceFor(req.entry)

  const padding = samplePadding(req.stroke)
  // Everything crossing contextBridge has to be structured-cloneable, and a
  // Vue reactive proxy is not — hence the explicit plain copy rather than
  // trusting every caller to hand over raw objects.
  const stroke = req.stroke
    ? {
        width: req.stroke.width,
        color: req.stroke.color,
        position: req.stroke.position,
      }
    : undefined

  const bmp = req.vertical
    ? window.engine.renderVertical(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.fillColor,
        stroke,
        req.phaseX,
        req.phaseY,
      )
    : window.engine.renderText(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.fillColor,
        stroke,
        req.phaseX,
        req.phaseY,
      )

  const missing = new Set(uncovered)
  return {
    image: new ImageData(new Uint8ClampedArray(bmp.rgba), bmp.width, bmp.height),
    marks: bmp.clusters.filter((rect) => missing.has(rect.cluster)),
    clusters: bmp.clusters,
    padding,
  }
}

const sources = new WeakMap<Sample, OffscreenCanvas>()

/**
 * The sample as something drawImage can scale. putImageData ignores the
 * context transform and only ever blits one for one, so a sample that has to
 * land at any size but its own goes through a canvas first. Held against the
 * sample because zooming repaints far more often than it re-rasterizes.
 */
export function sampleSource(sample: Sample): OffscreenCanvas {
  const held = sources.get(sample)
  if (held) return held

  const off = new OffscreenCanvas(sample.image.width, sample.image.height)
  const ctx = off.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.putImageData(sample.image, 0, 0)
  sources.set(sample, off)
  return off
}

export function sampleFor(req: SampleRequest): Sample {
  const key = keyOf(req)

  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const sample = rasterize(req)
  cache.set(key, sample)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return sample
}
