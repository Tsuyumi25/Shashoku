import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayerEffect } from '@shared/effects/types'
import { effectMargin, effectedFrame, layerWithEffects } from './layerEffects'

class StubImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

interface Blit {
  dx: number
  dy: number
  dw: number
  dh: number
}

/** What the source was drawn into the padded buffer as, per canvas made. */
let blits: Blit[] = []

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return {
      drawImage: (_src: unknown, dx: number, dy: number, dw: number, dh: number) => {
        blits.push({ dx, dy, dw, dh })
      },
      getImageData: (_x: number, _y: number, w: number, h: number) =>
        new StubImageData(new Uint8ClampedArray(w * h * 4), w, h),
      putImageData: () => {},
    }
  }
}

interface Handed {
  bytes: number
  width: number
  height: number
  strokes: readonly { width: number; color: string }[]
}

let handed: Handed[] = []

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('ImageData', StubImageData)
  vi.stubGlobal('window', {
    engine: {
      strokeLayer: (rgba: Uint8Array, width: number, height: number, strokes: Handed['strokes']) => {
        handed.push({ bytes: rgba.length, width, height, strokes })
        return new Uint8Array(width * height * 4)
      },
    },
  })
})

beforeEach(() => {
  blits = []
  handed = []
})

const SOURCE = {} as unknown as CanvasImageSource
const FRAME = { x: 40, y: 60, w: 100, h: 80 }

function stroke(width: number, color = '#000000'): LayerEffect {
  return { kind: 'stroke', width, color, position: 'outside' }
}

describe('effectMargin', () => {
  it('is nothing at all when a node carries no effects', () => {
    expect(effectMargin([])).toBe(0)
  })

  /** The band reaches `width` out, and its own soft edge sits past that. */
  it('leaves room for the band and for the edge of the band', () => {
    expect(effectMargin([{ width: 3, color: '#000' }])).toBe(4)
  })

  it('leaves room for every band, since each grows from the last', () => {
    expect(effectMargin([{ width: 3, color: '#000' }, { width: 2, color: '#fff' }])).toBe(6)
  })

  it('rounds a fractional width up rather than clipping the fraction off', () => {
    expect(effectMargin([{ width: 2.25, color: '#000' }])).toBe(4)
  })
})

describe('layerWithEffects', () => {
  it('leaves a layer that carries none alone, without asking the engine', () => {
    expect(layerWithEffects(SOURCE, FRAME, [])).toBeNull()
    expect(handed).toEqual([])
  })

  /**
   * A layer nothing has been written to yet has no frame, so there is no content
   * for a band to grow from — which is what a stroke on a blank layer drawing
   * nothing means, rather than a case anybody has to guard against.
   */
  it('draws nothing for a layer that has no frame yet', () => {
    expect(layerWithEffects(SOURCE, { x: 0, y: 0, w: 0, h: 0 }, [stroke(3)])).toBeNull()
    expect(handed).toEqual([])
  })

  it('grows the rectangle the layer occupies on every side', () => {
    const out = layerWithEffects(SOURCE, FRAME, [stroke(3)])
    expect(out?.frame).toEqual({ x: 36, y: 56, w: 108, h: 88 })
  })

  it('hands the engine the whole grown region, the layer sitting inside it', () => {
    layerWithEffects(SOURCE, FRAME, [stroke(3)])

    expect(handed).toHaveLength(1)
    expect(handed[0].width).toBe(108)
    expect(handed[0].height).toBe(88)
    expect(handed[0].bytes).toBe(108 * 88 * 4)
    expect(blits).toEqual([{ dx: 4, dy: 4, dw: 100, dh: 80 }])
  })

  it('hands over every stroke in the order the node lists them', () => {
    layerWithEffects(SOURCE, FRAME, [stroke(3, '#111111'), stroke(2, '#222222')])
    expect(handed[0].strokes.map((s) => s.color)).toEqual(['#111111', '#222222'])
  })
})

describe('effectedFrame', () => {
  it('says the same rectangle for a layer that carries nothing', () => {
    expect(effectedFrame(FRAME, [])).toEqual(FRAME)
  })

  /** What the composite draws and what merge reserves have to be one answer. */
  it('agrees with what the composed picture came back as', () => {
    const effects = [stroke(3)]
    expect(effectedFrame(FRAME, effects)).toEqual(layerWithEffects(SOURCE, FRAME, effects)?.frame)
  })

  it('leaves a layer with no frame where it is rather than inventing one', () => {
    const empty = { x: 5, y: 5, w: 0, h: 0 }
    expect(effectedFrame(empty, [stroke(3)])).toEqual(empty)
  })
})
