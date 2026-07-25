import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { engineSourceFor } from './fontCatalog'

export interface SampleRequest {
  entry: FontEntry
  text: string
  /** Device pixels, so the sample stays crisp on a HiDPI display. */
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
}

/** Roughly 17KB per bitmap at the default sample size. */
const CACHE_LIMIT = 240

/**
 * A system face has no path, so its bytes have to be pulled through the Local
 * Font Access API — tens of megabytes for a CJK family. Rasterizing a whole
 * viewport at once would hold all of them at the same time, so only a couple
 * are ever in flight and the rest of the grid shows placeholders until their
 * turn comes.
 */
const MAX_CONCURRENT = 2

const cache = new Map<string, ImageData>()
const inFlight = new Map<string, Promise<ImageData>>()

let active = 0
const waiting: (() => void)[] = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      active += 1
      resolve()
    })
  })
}

function release() {
  active -= 1
  waiting.shift()?.()
}

function keyOf(req: SampleRequest): string {
  const stroke = req.stroke
    ? `${req.stroke.width}/${req.stroke.color}/${req.stroke.position ?? 'outside'}`
    : '-'
  return `${req.entry.family}|${req.sizePx}|${req.fillColor}|${stroke}|${req.text}`
}

export function cachedSample(req: SampleRequest): ImageData | undefined {
  const key = keyOf(req)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

async function rasterize(req: SampleRequest): Promise<ImageData> {
  await acquire()
  try {
    const source = await engineSourceFor(req.entry)
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
      source,
      req.text,
      req.sizePx,
      padding,
      req.fillColor,
      stroke,
    )
    return new ImageData(new Uint8ClampedArray(bmp.rgba), bmp.width, bmp.height)
  } finally {
    release()
  }
}

export function loadSample(req: SampleRequest): Promise<ImageData> {
  const key = keyOf(req)

  const hit = cachedSample(req)
  if (hit) return Promise.resolve(hit)

  const running = inFlight.get(key)
  if (running) return running

  const task = rasterize(req)
    .then((data) => {
      cache.set(key, data)
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return data
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, task)
  return task
}
