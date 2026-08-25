import { describe, expect, it } from 'vitest'
import { artworkSignature } from './pageComposite'
import { pageStack } from '@shared/page/stack'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { blankTextObject, emptyBody } from '@shared/page/schema'

function raster(id: string, over: Partial<RasterLayerEntry> = {}): RasterLayerEntry {
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
    w: 100,
    h: 100,
    alphaLocked: false,
    ...over,
  }
}

function folder(id: string, children: LayerEntry[], over: Partial<GroupLayerEntry> = {}): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'pass-through',
    effects: [],
    name: id,
    children,
    ...over,
  }
}

function text(id: string): TextLayerEntry {
  return {
    ...blankTextObject(id, DEFAULT_TEXT_STYLE),
    translation: {
      ...emptyBody(DEFAULT_TEXT_STYLE),
      lines: ['x'],
      candidates: [],
      chosen: null,
    },
  }
}

function sign(layers: LayerEntry[]): string {
  return artworkSignature(pageStack(layers))
}

describe('what the artwork composite would read', () => {
  it('changes when a raster moves', () => {
    expect(sign([raster('a')])).not.toBe(sign([raster('a', { x: 10 })]))
  })

  it('changes when a raster is repainted into a new file', () => {
    expect(sign([raster('a')])).not.toBe(sign([raster('a', { file: 'a.rev2.png' })]))
  })

  it('changes when a raster is hidden', () => {
    expect(sign([raster('a'), raster('b')])).not.toBe(
      sign([raster('a'), raster('b', { visible: false })]),
    )
  })

  it('changes when the order is swapped', () => {
    expect(sign([raster('a'), raster('b')])).not.toBe(sign([raster('b'), raster('a')]))
  })

  // A folder carries paint of its own, and it reaches the page without any
  // layer inside it having changed. Reading only the rasters inside would miss
  // it, and the wand would go on sampling a picture the screen no longer shows.
  it('changes when a folder alone is turned down', () => {
    const inside = [raster('a')]
    expect(sign([folder('g', inside)])).not.toBe(sign([folder('g', inside, { opacity: 0.5 })]))
  })

  it('changes when a folder alone changes how it blends', () => {
    const inside = [raster('a')]
    expect(sign([folder('g', inside)])).not.toBe(
      sign([folder('g', inside, { blendMode: 'multiply' })]),
    )
  })

  // A stroke is composited rather than written into the layer, so the file the
  // signature names is unchanged while the picture under the wand is not.
  it('changes when a raster grows a stroke', () => {
    expect(sign([raster('a')])).not.toBe(
      sign([
        raster('a', {
          effects: [{ kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }],
        }),
      ]),
    )
  })

  // Typing is the most frequent edit there is, and the composite leaves text
  // out — so it must not throw away a sample that is still good.
  it('holds still while text is added, moved and edited', () => {
    const before = sign([raster('a')])
    expect(sign([raster('a'), text('t1')])).toBe(before)
    expect(sign([text('t1'), raster('a'), text('t2')])).toBe(before)
  })
})
