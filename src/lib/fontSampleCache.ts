import type {
  EngineClusterRect,
  EngineMeasure,
  EngineSpan,
  EngineStrokeSpec,
} from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import type { TextAlign } from '@shared/text-style/types'
import { engineSourceFor, faceKey } from './fontCatalog'

export interface SampleRequest {
  /**
   * Null when this machine has no face for the family the object named. The
   * engine then draws a grid of notdef boxes, which is still shaped by `text`
   * and `vertical` — only the glyphs are unavailable, not the text.
   */
  entry: FontEntry | null
  text: string
  /** Device pixels, so the sample stays crisp on a HiDPI display. */
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Columns running right to left instead of rows. */
  vertical?: boolean
  /** Where a line short of the longest one sits. Part of what got drawn. */
  align?: TextAlign
  /**
   * The object's own turn, in radians, applied to the outline before any
   * coverage is computed. Part of the identity of the bitmap, and the reason
   * the caller has to quantise it: an unrounded angle would rasterize the
   * whole run on every frame of a rotation.
   */
  rotation?: number
  /**
   * How far into its own pixel the run starts, in bitmap pixels. Part of the
   * identity of the bitmap, so it is part of the key — and why the caller has
   * to round it to something coarse before asking.
   */
  phaseX?: number
  phaseY?: number
  /**
   * Signed pixels the strokes move by. Part of the identity of the bitmap, so
   * part of the key — two objects agreeing on everything but this are not
   * looking at the same picture.
   */
  weightPx?: number
  /**
   * Stretches set differently from the rest of the run, in UTF-8 byte offsets
   * into `text`. Part of the identity of both the bitmap and the frame — a
   * span carries its own size, so it moves what the run measures.
   */
  spans?: readonly EngineSpan[]
  /**
   * Horizontal and vertical character scale, as fractions of `sizePx`. Part of
   * the identity of both the bitmap and the frame: every glyph is drawn and
   * every advance counted through them.
   */
  scaleX?: number
  scaleY?: number
}

export interface Sample {
  image: ImageData
  /**
   * Boxes around the characters `entry` has no glyph for, in bitmap pixels.
   * Empty for a notdef box: coverage is a question about a face, and that case
   * is the one where there is no face.
   */
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
 * A measure is a few numbers and a cluster table, so the frames of everything
 * on a page fit for less than one bitmap costs.
 */
const MEASURE_CACHE_LIMIT = 1024

/**
 * Blank margin around a sample. An outside stroke grows the glyph past its
 * advance box; without room for it the sample comes back clipped. Thickening
 * grows it the same way, so it buys margin too — thinning does not, since it
 * only ever pulls the edge inward.
 */
export function samplePadding(stroke?: EngineStrokeSpec, weightPx = 0): number {
  return 4 + Math.ceil(stroke?.width ?? 0) + Math.ceil(Math.max(0, weightPx))
}

/**
 * The margin this request needs. A span may be thickened past the run's own
 * weight, and the margin has to answer to the heaviest thing drawn rather than
 * to the base — one span bolder than the rest would come back clipped.
 */
function paddingOf(req: SampleRequest): number {
  let weight = req.weightPx ?? 0
  for (const span of req.spans ?? []) weight = Math.max(weight, span.weightPx)
  return samplePadding(req.stroke, weight)
}

/**
 * The spans as one string, with or without what only painting sees. The two
 * keys share it so they cannot drift about what a span is, while the measure
 * key keeps the same promise the rest of it makes: a colour cannot move the
 * frame, and a weight only reaches it through the padding that is already in
 * that key.
 */
function spansKey(spans: readonly EngineSpan[] | undefined, paint: boolean): string {
  if (!spans || spans.length === 0) return '-'
  return spans
    .map((s) => {
      const shape = `${s.start}-${s.end}:${s.sizePx}:${s.upright ? 'u' : ''}`
      return paint ? `${shape}:${s.color}:${s.weightPx}` : shape
    })
    .join(';')
}

/**
 * Plain copies of the spans, or nothing when there are none — the same reason
 * the stroke is copied below: a Vue reactive proxy cannot cross contextBridge.
 */
function engineSpans(spans: readonly EngineSpan[] | undefined): EngineSpan[] | undefined {
  if (!spans || spans.length === 0) return undefined
  return spans.map((s) => ({
    start: s.start,
    end: s.end,
    sizePx: s.sizePx,
    color: s.color,
    weightPx: s.weightPx,
    upright: s.upright,
  }))
}

const cache = new Map<string, Sample>()
const measures = new Map<string, EngineMeasure>()
const coverage = new Map<string, number[]>()

/** LRU by re-insertion, which Map iteration order makes exact. */
function remembered<V>(held: Map<string, V>, key: string, limit: number, make: () => V): V {
  const hit = held.get(key)
  if (hit !== undefined) {
    held.delete(key)
    held.set(key, hit)
    return hit
  }
  const made = make()
  held.set(key, made)
  while (held.size > limit) {
    const oldest = held.keys().next().value
    if (oldest === undefined) break
    held.delete(oldest)
  }
  return made
}

function coverageKey(entry: FontEntry, text: string): string {
  return `${faceKey(entry)}|${text}`
}

function keyOf(req: SampleRequest): string {
  const stroke = req.stroke
    ? `${req.stroke.width}/${req.stroke.color}/${req.stroke.position ?? 'outside'}`
    : '-'
  // The tag keeps the two key spaces apart, so a face that happened to be
  // named like the notdef key could not answer for it.
  return [
    req.entry ? `f${faceKey(req.entry)}` : 'n',
    req.sizePx,
    req.fillColor,
    stroke,
    req.vertical ? 'v' : 'h',
    req.align ?? 'start',
    req.rotation ?? 0,
    `${req.phaseX ?? 0},${req.phaseY ?? 0}`,
    req.weightPx ?? 0,
    `${req.scaleX ?? 1},${req.scaleY ?? 1}`,
    spansKey(req.spans, true),
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
  const padding = paddingOf(req)
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
  const spans = engineSpans(req.spans)

  if (!req.entry) {
    const grid = window.engine.renderNotdef(
      req.text,
      req.sizePx,
      padding,
      req.vertical,
      req.rotation,
      req.fillColor,
      stroke,
      req.phaseX,
      req.phaseY,
      req.align,
      req.weightPx,
    )
    // No marks: coverage is a question about a face, and there is no face.
    return {
      image: new ImageData(new Uint8ClampedArray(grid.rgba), grid.width, grid.height),
      marks: [],
      clusters: grid.clusters,
      padding,
    }
  }

  const uncovered = coverageFor(req.entry, req.text)
  const drawWith = engineSourceFor(req.entry)

  const bmp = req.vertical
    ? window.engine.renderVertical(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.rotation,
        req.fillColor,
        stroke,
        req.phaseX,
        req.phaseY,
        req.align,
        req.weightPx,
        spans,
        req.scaleX,
        req.scaleY,
      )
    : window.engine.renderText(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.rotation,
        req.fillColor,
        stroke,
        req.phaseX,
        req.phaseY,
        req.align,
        req.weightPx,
        spans,
        req.scaleX,
        req.scaleY,
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
  return remembered(cache, keyOf(req), CACHE_LIMIT, () => rasterize(req))
}

/**
 * Geometry only, so the paint fields stay out of the key: colours cannot move
 * the frame, and the stroke and weight only reach it through the padding.
 */
function measureKeyOf(req: SampleRequest, padding: number): string {
  return [
    req.entry ? `f${faceKey(req.entry)}` : 'n',
    req.sizePx,
    padding,
    req.vertical ? 'v' : 'h',
    req.align ?? 'start',
    req.rotation ?? 0,
    `${req.phaseX ?? 0},${req.phaseY ?? 0}`,
    `${req.scaleX ?? 1},${req.scaleY ?? 1}`,
    spansKey(req.spans, false),
    req.text,
  ].join('|')
}

function measure(req: SampleRequest, padding: number): EngineMeasure {
  const spans = engineSpans(req.spans)
  if (!req.entry) {
    return window.engine.measureNotdef(
      req.text,
      req.sizePx,
      padding,
      req.vertical,
      req.rotation,
      req.phaseX,
      req.phaseY,
      req.align,
    )
  }
  const drawWith = engineSourceFor(req.entry)
  return req.vertical
    ? window.engine.measureVertical(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.rotation,
        req.phaseX,
        req.phaseY,
        req.align,
        spans,
        req.scaleX,
        req.scaleY,
      )
    : window.engine.measureText(
        drawWith,
        req.text,
        req.sizePx,
        padding,
        req.rotation,
        req.phaseX,
        req.phaseY,
        req.align,
        spans,
        req.scaleX,
        req.scaleY,
      )
}

/**
 * The frame `sampleFor` would come back in, for the callers that only size or
 * place things: the same request, none of the painting. Takes the full request
 * so a caller cannot hand the two calls different geometry by accident.
 */
export function measureFor(req: SampleRequest): EngineMeasure {
  const padding = paddingOf(req)
  return remembered(measures, measureKeyOf(req, padding), MEASURE_CACHE_LIMIT, () =>
    measure(req, padding),
  )
}

/** The sample if it is already drawn, without drawing it. */
export function cachedSample(req: SampleRequest): Sample | undefined {
  return cache.get(keyOf(req))
}
