import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from './types'
import { PASS_THROUGH } from './types'
import { pageStack, stackedRasterNodes, stackedTextNodes, originalStack, withoutText, type StackNode } from './stack'
import { blankSourceBlock, blankTranslationBlock } from './schema'

const FACE = 'f'
const OTHER = 'g'

function text(id: string, extra: Partial<TextLayerEntry> = {}, face = FACE): TextLayerEntry {
  const entry = blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
  entry.body.lines = [id]
  return Object.assign(entry, extra)
}

function source(id: string, extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
  const entry = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
  entry.body.lines = [id]
  return Object.assign(entry, extra)
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
    effects: [],
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
    effects: [],
    children,
    ...extra,
  }
}

const idsOf = (nodes: readonly StackNode[]): string[] => nodes.map((n) => n.entry.id)

describe('pageStack', () => {
  it('has nothing to draw for an empty page', () => {
    expect(pageStack([], 'translation', FACE)).toEqual([])
  })

  // The array runs bottom to top, and so does the answer: the last entry is
  // drawn last and so ends up on top.
  it("keeps the tree's order, which is the order things are drawn", () => {
    expect(idsOf(pageStack([raster('a'), text('b'), raster('c')], 'translation', FACE))).toEqual(['a', 'b', 'c'])
  })

  it('leaves a hidden entry out', () => {
    expect(idsOf(pageStack([text('a'), text('b', { visible: false })], 'translation', FACE))).toEqual(['a'])
  })

  it('takes everything under a hidden folder out with it', () => {
    const page = [folder('g', [text('a'), raster('b')], { visible: false }), text('c')]
    expect(idsOf(pageStack(page, 'translation', FACE))).toEqual(['c'])
  })

  it('takes out what a hidden ancestor holds however deep it sits', () => {
    expect(pageStack([folder('g', [folder('h', [text('a')])], { visible: false })], 'translation', FACE)).toEqual([])
  })

  it("carries a leaf's own blending", () => {
    const [node] = pageStack([raster('a', { opacity: 0.4, blendMode: 'multiply' })], 'translation', FACE)
    expect([node.opacity, node.blendMode]).toEqual([0.4, 'multiply'])
  })
})

/**
 * What a page exports as is always one face, and the artwork's own words are a
 * second page laid over the same drawing.
 */
describe('one side and one face at a time', () => {
  const layers = [raster('base'), source('s'), text('a'), text('b', {}, OTHER)]

  it("draws the lettering of the face asked for and no other face's", () => {
    expect(idsOf(pageStack(layers, 'translation', FACE))).toEqual(['base', 'a'])
    expect(idsOf(pageStack(layers, 'translation', OTHER))).toEqual(['base', 'b'])
  })

  /** The artwork belongs to every face, so the source side reads the same whichever is asked for. */
  it('draws the same source side whichever face asks', () => {
    expect(idsOf(pageStack(layers, 'source', FACE))).toEqual(['base', 's'])
    expect(idsOf(pageStack(layers, 'source', OTHER))).toEqual(['base', 's'])
  })

  it('reaches a face through the folders the lettering sits in', () => {
    const nested = [folder('g', [text('a'), folder('h', [text('b', {}, OTHER)])])]
    expect(idsOf(pageStack(nested, 'translation', FACE))).toEqual(['a'])
    expect(idsOf(pageStack(nested, 'translation', OTHER))).toEqual(['b'])
  })

  it("leaves out a buffer that would hold nothing but another face's lettering", () => {
    const page = [folder('g', [text('a', {}, OTHER)], { opacity: 0.5 }), text('b')]
    expect(idsOf(pageStack(page, 'translation', FACE))).toEqual(['b'])
  })
})

describe('a folder only becomes a buffer when it has to', () => {
  it('flattens a pass-through folder at full opacity into what holds it', () => {
    const page = [text('a'), folder('g', [raster('b'), text('c')]), text('d')]
    expect(idsOf(pageStack(page, 'translation', FACE))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('flattens through several levels at once', () => {
    const page = [folder('g', [folder('h', [text('a')]), text('b')])]
    expect(idsOf(pageStack(page, 'translation', FACE))).toEqual(['a', 'b'])
  })

  // A folder's opacity cannot apply until its contents are one picture, and a
  // buffer is what makes them one.
  it('buffers a folder that has an opacity of its own', () => {
    const [node] = pageStack([folder('g', [text('a')], { opacity: 0.5 })], 'translation', FACE)
    expect(node.kind).toBe('buffer')
    expect(node.opacity).toBe(0.5)
    expect(node.kind === 'buffer' && idsOf(node.children)).toEqual(['a'])
  })

  it('buffers a folder that blends, even at full opacity', () => {
    const [node] = pageStack([folder('g', [text('a')], { blendMode: 'multiply' })], 'translation', FACE)
    expect(node.kind).toBe('buffer')
    expect(node.blendMode).toBe('multiply')
  })

  /**
   * Pass-through means "no buffer of my own", so once one is forced the mode has
   * nothing left to say and the buffer meets the page the ordinary way. No
   * consumer should ever be handed pass-through to draw with.
   */
  it('composites a buffered pass-through folder normally', () => {
    const [node] = pageStack([folder('g', [text('a')], { opacity: 0.5 })], 'translation', FACE)
    expect(node.blendMode).toBe('normal')
  })

  it('leaves out a folder that would buffer nothing', () => {
    const page = [folder('g', [text('a', { visible: false })], { opacity: 0.5 }), text('b')]
    expect(idsOf(pageStack(page, 'translation', FACE))).toEqual(['b'])
  })

  // A frame is a hit target rather than part of the picture, so the canvas
  // wants every text object it will draw in one flat layer over the top.
  it('lists the text objects inside a buffer along with the rest', () => {
    const page = [text('a'), folder('g', [text('b')], { opacity: 0.5 }), raster('c'), text('d')]
    const ids = stackedTextNodes(pageStack(page, 'translation', FACE)).map((n) => n.entry.id)
    expect(ids).toEqual(['a', 'b', 'd'])
  })

  it('flattens the children of a buffer that are themselves plain folders', () => {
    const page = [folder('g', [folder('h', [text('a'), text('b')])], { opacity: 0.5 })]
    const [node] = pageStack(page, 'translation', FACE)
    expect(node.kind === 'buffer' && idsOf(node.children)).toEqual(['a', 'b'])
  })

  it('lists the raster layers inside a buffer along with the rest', () => {
    const page = [raster('a'), folder('g', [raster('b')], { opacity: 0.5 }), text('c'), raster('d')]
    const ids = stackedRasterNodes(pageStack(page, 'translation', FACE)).map((n) => n.entry.id)
    expect(ids).toEqual(['a', 'b', 'd'])
  })

  // A frame is offered for something on the page; a hidden layer is not on it.
  it('leaves out a raster layer a folder is hiding', () => {
    const page = [raster('a'), folder('g', [raster('b')], { visible: false })]
    expect(stackedRasterNodes(pageStack(page, 'translation', FACE)).map((n) => n.entry.id)).toEqual(['a'])
  })
})

describe('the canvas with its text taken out', () => {
  it('leaves the artwork, folders included, and none of the text', () => {
    const stack = pageStack(
      [raster('base'), text('a'), folder('g', [text('b'), raster('patch')], { blendMode: 'multiply' })],
      'translation',
      FACE,
    )

    const shown = withoutText(stack)

    expect(stackedTextNodes(shown)).toEqual([])
    expect(stackedRasterNodes(shown).map((n) => n.entry.id)).toEqual(['base', 'patch'])
  })

  /** The switch belongs to the view, so what comes back is what was showing before. */
  it('brings back exactly the text that was showing, a hidden object still hidden', () => {
    const layers = [text('a'), text('b', { visible: false }), text('c')]
    const before = idsOf(stackedTextNodes(pageStack(layers, 'translation', FACE)))

    withoutText(pageStack(layers, 'translation', FACE))

    expect(idsOf(stackedTextNodes(pageStack(layers, 'translation', FACE)))).toEqual(before)
    expect(before).toEqual(['a', 'c'])
    expect(layers.map((l) => l.visible)).toEqual([true, false, true])
  })
})

describe('the page as only its original', () => {
  it('draws the bottom raster alone, plainly, even when it is hidden or dimmed', () => {
    const layers = [
      folder('g', [raster('base', { visible: false, opacity: 0.3, blendMode: 'multiply' }), text('x')]),
      raster('retouch'),
      text('a'),
    ]

    const shown = originalStack(layers)

    expect(idsOf(shown)).toEqual(['base'])
    expect(shown[0]).toMatchObject({ opacity: 1, blendMode: 'normal' })
    expect(stackedTextNodes(shown)).toEqual([])
  })

  it('has nothing to show on a page with no raster at all', () => {
    expect(originalStack([text('a')])).toEqual([])
  })
})
