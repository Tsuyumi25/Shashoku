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
  /**
   * Family to draw with when `entry` cannot cover the text. Swapping the whole
   * run rather than the missing characters alone keeps shaping intact, at the
   * cost of hiding what a nearly-complete family actually looks like.
   */
  fallback?: FontEntry
}

export interface Sample {
  image: ImageData
  /** Boxes around the characters `entry` has no glyph for, in bitmap pixels. */
  marks: EngineClusterRect[]
  /** Whether the bitmap was drawn by the fallback family instead of `entry`. */
  substituted: boolean
}

/** Roughly 17KB per bitmap at the default sample size. */
const CACHE_LIMIT = 240

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
    req.fallback?.family ?? '-',
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
  const substituted = uncovered.length > 0 && req.fallback !== undefined
  const drawWith = engineSourceFor(substituted ? req.fallback! : req.entry)

  // An outside stroke grows the glyph past its advance box; without room for
  // it the sample comes back clipped.
  const padding = 4 + Math.ceil(req.stroke?.width ?? 0)
  // Everything crossing contextBridge has to be structured-cloneable, and a
  // Vue reactive proxy is not — hence the explicit plain copy rather than
  // trusting every caller to hand over raw objects.
  const stroke = req.stroke
    ? {
        width: req.stroke.width,
        color: req.stroke.color,
        position: req.stroke.position,
        join: req.stroke.join,
      }
    : undefined

  const bmp = window.engine.renderText(
    drawWith,
    req.text,
    req.sizePx,
    padding,
    req.fillColor,
    stroke,
  )

  // Coverage was measured against the requested family while the clusters come
  // from whichever family drew — both index the same string, so the marks still
  // land on the characters that were missing.
  const missing = new Set(uncovered)
  return {
    image: new ImageData(new Uint8ClampedArray(bmp.rgba), bmp.width, bmp.height),
    marks: bmp.clusters.filter((rect) => missing.has(rect.cluster)),
    substituted,
  }
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
