import { describe, expect, it } from 'vitest'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from './types'
import { PASS_THROUGH } from './types'
import { pageStack, stackedTextNodes, type StackNode } from './stack'

function text(id: string, extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
  return {
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
    ...extra,
  }
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
    w: 10,
    h: 10,
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

const idsOf = (nodes: readonly StackNode[]): string[] => nodes.map((n) => n.entry.id)

describe('pageStack', () => {
  it('has nothing to draw for an empty page', () => {
    expect(pageStack([])).toEqual([])
  })

  // The array runs bottom to top, and so does the answer: the last entry is
  // drawn last and so ends up on top.
  it("keeps the tree's order, which is the order things are drawn", () => {
    expect(idsOf(pageStack([raster('a'), text('b'), raster('c')]))).toEqual(['a', 'b', 'c'])
  })

  it('leaves a hidden entry out', () => {
    expect(idsOf(pageStack([text('a'), text('b', { visible: false })]))).toEqual(['a'])
  })

  it('takes everything under a hidden folder out with it', () => {
    const page = [folder('g', [text('a'), raster('b')], { visible: false }), text('c')]
    expect(idsOf(pageStack(page))).toEqual(['c'])
  })

  it('takes out what a hidden ancestor holds however deep it sits', () => {
    expect(pageStack([folder('g', [folder('h', [text('a')])], { visible: false })])).toEqual([])
  })

  it("carries a leaf's own blending", () => {
    const [node] = pageStack([raster('a', { opacity: 0.4, blendMode: 'multiply' })])
    expect([node.opacity, node.blendMode]).toEqual([0.4, 'multiply'])
  })
})

describe('a folder only becomes a buffer when it has to', () => {
  it('flattens a pass-through folder at full opacity into what holds it', () => {
    const page = [text('a'), folder('g', [raster('b'), text('c')]), text('d')]
    expect(idsOf(pageStack(page))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('flattens through several levels at once', () => {
    const page = [folder('g', [folder('h', [text('a')]), text('b')])]
    expect(idsOf(pageStack(page))).toEqual(['a', 'b'])
  })

  // A folder's opacity cannot apply until its contents are one picture, and a
  // buffer is what makes them one.
  it('buffers a folder that has an opacity of its own', () => {
    const [node] = pageStack([folder('g', [text('a')], { opacity: 0.5 })])
    expect(node.kind).toBe('buffer')
    expect(node.opacity).toBe(0.5)
    expect(node.kind === 'buffer' && idsOf(node.children)).toEqual(['a'])
  })

  it('buffers a folder that blends, even at full opacity', () => {
    const [node] = pageStack([folder('g', [text('a')], { blendMode: 'multiply' })])
    expect(node.kind).toBe('buffer')
    expect(node.blendMode).toBe('multiply')
  })

  /**
   * Pass-through means "no buffer of my own", so once one is forced the mode has
   * nothing left to say and the buffer meets the page the ordinary way. No
   * consumer should ever be handed pass-through to draw with.
   */
  it('composites a buffered pass-through folder normally', () => {
    const [node] = pageStack([folder('g', [text('a')], { opacity: 0.5 })])
    expect(node.blendMode).toBe('normal')
  })

  it('leaves out a folder that would buffer nothing', () => {
    const page = [folder('g', [text('a', { visible: false })], { opacity: 0.5 }), text('b')]
    expect(idsOf(pageStack(page))).toEqual(['b'])
  })

  // A frame is a hit target rather than part of the picture, so the canvas
  // wants every text object it will draw in one flat layer over the top.
  it('lists the text objects inside a buffer along with the rest', () => {
    const page = [text('a'), folder('g', [text('b')], { opacity: 0.5 }), raster('c'), text('d')]
    const ids = stackedTextNodes(pageStack(page)).map((n) => n.entry.id)
    expect(ids).toEqual(['a', 'b', 'd'])
  })

  it('flattens the children of a buffer that are themselves plain folders', () => {
    const page = [folder('g', [folder('h', [text('a'), text('b')])], { opacity: 0.5 })]
    const [node] = pageStack(page)
    expect(node.kind === 'buffer' && idsOf(node.children)).toEqual(['a', 'b'])
  })
})
