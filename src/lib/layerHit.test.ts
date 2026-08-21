import { describe, expect, it } from 'vitest'
import { pageStack } from '@shared/page/stack'
import { isLocked } from '@shared/page/tree'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { framedLayers, layerAt } from '@/lib/layerHit'

interface Frame {
  x: number
  y: number
  w: number
  h: number
}

function raster(id: string, extra: Partial<RasterLayerEntry> = {}): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    alphaLocked: false,
    ...extra,
  }
}

function folder(
  id: string,
  children: LayerEntry[],
  extra: Partial<GroupLayerEntry> = {},
): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: PASS_THROUGH,
    children,
    ...extra,
  }
}

/** One character per pixel, in each layer's own local coordinates. */
const ALPHA: Record<string, number> = { '.': 0, '#': 255, '1': 1 }

const PIXELS: Record<string, string[]> = {
  'bottom.png': ['####', '####', '####', '####'],
  // Its top-left quarter is see-through, and the row below that holds the
  // faintest pixel there is.
  'top.png': ['....', '..1#', '####', '####'],
}

/**
 * The lower patch covers the page's top-left corner; the upper one is offset
 * down and right, so their frames overlap over a quarter of each.
 *
 * `live` stands for a layer the engine is holding, whose pixels have moved on
 * from what its entry says — which is every layer being edited, since the
 * manifest is not written before the file it names.
 */
function scene(layers: LayerEntry[], live: Record<string, Frame> = {}) {
  const nodes = pageStack(layers)
  const frameOf = (entry: RasterLayerEntry): Frame => live[entry.id] ?? entry
  // Reads at the frame the pixels are really at, as the renderer's plane does.
  const alphaAt = (entry: RasterLayerEntry, at: { x: number; y: number }): number => {
    const rows = PIXELS[entry.file]
    if (rows === undefined) throw new Error(`asked for pixels of ${entry.file}`)
    const frame = frameOf(entry)
    return ALPHA[rows[at.y - frame.y][at.x - frame.x]]
  }
  return {
    framed: framedLayers(nodes, (id) => isLocked(layers, id), frameOf),
    at: (x: number, y: number) =>
      layerAt(nodes, { x, y }, (id) => isLocked(layers, id), alphaAt, frameOf),
  }
}

const BOTTOM = raster('bottom')
const TOP = raster('top', { x: 2, y: 2 })

describe('layerAt', () => {
  it('takes the upper layer where it has a pixel', () => {
    expect(scene([BOTTOM, TOP]).at(4, 4)).toBe('top')
  })

  it('falls through where the upper layer is see-through', () => {
    expect(scene([BOTTOM, TOP]).at(2, 2)).toBe('bottom')
  })

  it('counts the faintest pixel as a hit', () => {
    // Page (4, 3) is alpha 1 on the upper layer and past the lower one's frame,
    // so only a threshold of any-non-zero can reach it.
    expect(scene([BOTTOM, TOP]).at(4, 3)).toBe('top')
  })

  it('is nothing outside every frame', () => {
    expect(scene([BOTTOM, TOP]).at(20, 20)).toBeNull()
  })

  it('is nothing inside a frame with no pixel there and nothing underneath', () => {
    expect(scene([BOTTOM, TOP]).at(5, 2)).toBeNull()
  })

  it('skips a layer that is switched off', () => {
    const hidden = raster('top', { x: 2, y: 2, visible: false })
    expect(scene([BOTTOM, TOP]).at(2, 4)).toBe('top')
    expect(scene([BOTTOM, hidden]).at(2, 4)).toBeNull()
  })

  it('skips a layer inside a folder that is switched off', () => {
    const shut = folder('g', [raster('top', { x: 2, y: 2 })], { visible: false })
    expect(scene([BOTTOM, shut]).at(2, 4)).toBeNull()
  })

  it('skips a locked layer, and one a folder above it locks', () => {
    const locked = raster('top', { x: 2, y: 2, locked: true })
    const shut = folder('g', [raster('top', { x: 2, y: 2 })], { locked: true })
    expect(scene([BOTTOM, locked]).at(2, 4)).toBeNull()
    expect(scene([BOTTOM, shut]).at(2, 4)).toBeNull()
  })

  it('skips a layer nothing has been painted on yet', () => {
    // Its pixels are never asked for, which is what the fake would throw over.
    const blank = raster('blank', { w: 0, h: 0 })
    expect(scene([BOTTOM, blank]).at(1, 1)).toBe('bottom')
  })

  /**
   * A layer painted this session has pixels the manifest has not been told
   * about, and for tens of seconds its entry still says the frame from before —
   * or, on a layer painted for the first time, no frame at all. Read off the
   * entry, the paint plainly on screen takes no pointer.
   */
  it('reaches a layer painted since the entry was written', () => {
    const blank = raster('top', { x: 0, y: 0, w: 0, h: 0 })
    const live = { top: { x: 2, y: 2, w: 4, h: 4 } }
    expect(scene([BOTTOM, blank], live).at(4, 4)).toBe('top')
  })

  it('bounds the hit by where the pixels are, not by where the entry says', () => {
    // The entry still describes the frame before the layer grew down and right.
    const grown = raster('top', { x: 2, y: 2, w: 1, h: 1 })
    const live = { top: { x: 2, y: 2, w: 4, h: 4 } }
    // Past the lower layer as well, so read off the entry the point reaches
    // nothing at all — which is the pointer falling through visible paint.
    expect(scene([BOTTOM, grown]).at(4, 4)).toBeNull()
    expect(scene([BOTTOM, grown], live).at(4, 4)).toBe('top')
  })
})

describe('framedLayers', () => {
  it('gives the drawn layers in drawing order', () => {
    expect(scene([BOTTOM, TOP]).framed.map((e) => e.id)).toEqual(['bottom', 'top'])
  })

  it('leaves out the locked and the unpainted', () => {
    const base = raster('base', { locked: true })
    const blank = raster('blank', { w: 0, h: 0 })
    expect(scene([base, BOTTOM, blank, TOP]).framed.map((e) => e.id)).toEqual(['bottom', 'top'])
  })

  it('walks into a folder that is on and past one that is off', () => {
    const open = folder('open', [raster('inside', { x: 2, y: 2 })])
    const shut = folder('shut', [raster('elsewhere')], { visible: false })
    expect(scene([BOTTOM, open, shut]).framed.map((e) => e.id)).toEqual(['bottom', 'inside'])
  })

  /** Unpainted means no pixels anywhere, not an entry that has yet to hear. */
  it('counts a layer painted since the entry was written', () => {
    const blank = raster('fresh', { w: 0, h: 0 })
    const live = { fresh: { x: 0, y: 0, w: 4, h: 4 } }
    expect(scene([BOTTOM, blank]).framed.map((e) => e.id)).toEqual(['bottom'])
    expect(scene([BOTTOM, blank], live).framed.map((e) => e.id)).toEqual(['bottom', 'fresh'])
  })
})
