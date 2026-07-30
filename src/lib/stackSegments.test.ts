import { describe, expect, it } from 'vitest'
import type { RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import type { StackNode } from '@shared/page/stack'
import { stackSegments } from '@/lib/stackSegments'

function raster(id: string, blendMode = 'normal', opacity = 1): StackNode {
  const entry: RasterLayerEntry = {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity,
    blendMode,
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    alphaLocked: false,
  }
  return { kind: 'raster', entry, opacity, blendMode }
}

function text(id: string): StackNode {
  const entry: TextLayerEntry = {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    groupId: null,
    rotation: 0,
    lines: [id],
  }
  return { kind: 'text', entry, opacity: 1, blendMode: 'normal' }
}

describe('stackSegments', () => {
  it('has nothing to draw for an empty stack', () => {
    expect(stackSegments([])).toEqual([])
  })

  /**
   * The reason this function exists: a screen-sized canvas is tens of megabytes,
   * and a page of erase patches would otherwise want one each.
   */
  it('gathers neighbouring plain rasters onto one canvas', () => {
    const segments = stackSegments([raster('a'), raster('b'), raster('c')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind === 'rasters' && segments[0].nodes.map((n) => n.entry.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('keeps a fading raster in the run, since its opacity is drawn in', () => {
    const segments = stackSegments([raster('a'), raster('b', 'normal', 0.5)])
    expect(segments).toHaveLength(1)
  })

  /**
   * A blend mode reads the backdrop, and a shared canvas has none — the page
   * under it is not in that canvas. So one that blends is drawn on its own,
   * where CSS can blend it against what is really behind it.
   */
  it('gives a raster that blends a canvas of its own', () => {
    const segments = stackSegments([raster('a'), raster('b', 'multiply'), raster('c')])
    expect(segments.map((s) => s.kind)).toEqual(['rasters', 'rasters', 'rasters'])
    expect(segments.map((s) => s.blendMode)).toEqual(['normal', 'multiply', 'normal'])
    expect(segments[1].kind === 'rasters' && segments[1].nodes).toHaveLength(1)
  })

  it('does not gather two rasters that blend the same way', () => {
    const segments = stackSegments([raster('a', 'multiply'), raster('b', 'multiply')])
    expect(segments).toHaveLength(2)
  })

  it('breaks a run where a text object comes between', () => {
    const segments = stackSegments([raster('a'), text('t'), raster('b')])
    expect(segments.map((s) => s.kind)).toEqual(['rasters', 'text', 'rasters'])
  })

  it('names each segment by its first entry, so the panel can key on it', () => {
    const segments = stackSegments([raster('a'), raster('b'), text('t')])
    expect(segments.map((s) => s.key)).toEqual(['a', 't'])
  })

  describe('with one layer held aside', () => {
    /**
     * A dragged layer is offset by a transform on its element, so it has to be
     * the only thing that element draws — otherwise its neighbours travel with
     * it.
     */
    it('gives the held layer an element of its own', () => {
      const segments = stackSegments([raster('a'), raster('b'), raster('c')], 'b')
      expect(segments.map((s) => s.kind)).toEqual(['rasters', 'rasters', 'rasters'])
      expect(segments.map((s) => s.key)).toEqual(['a', 'b', 'c'])
      expect(segments[1].kind === 'rasters' && segments[1].nodes).toHaveLength(1)
    })

    it("closes the run behind it, so what follows does not join the held layer", () => {
      const segments = stackSegments([raster('a'), raster('b')], 'a')
      expect(segments).toHaveLength(2)
      expect(segments[0].kind === 'rasters' && segments[0].nodes).toHaveLength(1)
    })

    it('leaves the rest of the page gathered as it was', () => {
      const segments = stackSegments([raster('a'), raster('b'), raster('c'), raster('d')], 'a')
      expect(segments).toHaveLength(2)
      expect(segments[1].kind === 'rasters' && segments[1].nodes.map((n) => n.entry.id)).toEqual([
        'b',
        'c',
        'd',
      ])
    })

    it('holds nothing aside for an id that is not on this page', () => {
      expect(stackSegments([raster('a'), raster('b')], 'gone')).toHaveLength(1)
    })

    it('holds nothing aside when nothing is being held', () => {
      expect(stackSegments([raster('a'), raster('b')], null)).toHaveLength(1)
    })
  })
})
