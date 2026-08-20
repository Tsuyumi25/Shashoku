import { describe, expect, it } from 'vitest'
import { pageStack } from '@shared/page/stack'
import { isLocked } from '@shared/page/tree'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { framedLayers, layerAt } from '@/lib/layerHit'

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

function alphaAt(entry: RasterLayerEntry, x: number, y: number): number {
  const rows = PIXELS[entry.file]
  if (rows === undefined) throw new Error(`asked for pixels of ${entry.file}`)
  return ALPHA[rows[y][x]]
}

/**
 * The lower patch covers the page's top-left corner; the upper one is offset
 * down and right, so their frames overlap over a quarter of each.
 */
function scene(layers: LayerEntry[]) {
  const nodes = pageStack(layers)
  return {
    framed: framedLayers(nodes, (id) => isLocked(layers, id)),
    at: (x: number, y: number) =>
      layerAt(nodes, { x, y }, (id) => isLocked(layers, id), alphaAt),
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
})
