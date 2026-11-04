import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DrawnLabel } from '@/lib/labelRaster'
import { joinedPixels } from './joinedStroke'

class StubImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

beforeAll(() => {
  vi.stubGlobal('ImageData', StubImageData)
})

type Pixel = [number, number, number, number]

/** A label whose bitmap is one colour, `w`×`h`, with its corner at `x`,`y`. */
function label(x: number, y: number, w: number, h: number, at: (px: number, py: number) => Pixel): DrawnLabel {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) data.set(at(px, py), (py * w + px) * 4)
  return {
    sample: { image: new StubImageData(data, w, h) as unknown as ImageData, marks: [], clusters: [], padding: 0 },
    missingFamily: null,
    box: { w, h },
    center: { x: x + w / 2, y: y + h / 2 },
    plain: '',
  }
}

const BAND: Pixel = [255, 255, 255, 255]
const INK: Pixel = [0, 0, 0, 255]
const pixelAt = (img: ImageData, x: number, y: number): Pixel =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)) as Pixel

describe('joinedPixels', () => {
  // Own bitmap: band everywhere, letters only in column 0.
  const own = label(0, 0, 4, 1, (x) => (x === 0 ? INK : BAND))
  const ownLetters = label(0, 0, 4, 1, (x) => (x === 0 ? INK : [0, 0, 0, 0]))

  it('takes the band off wherever an object under it is solid', () => {
    const under = label(2, 0, 2, 1, () => INK)
    const out = joinedPixels(own, ownLetters, 'outside', [under])!
    expect(pixelAt(out, 1, 0)).toEqual(BAND)
    expect(pixelAt(out, 2, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(out, 3, 0)).toEqual([0, 0, 0, 0])
  })

  /** Erasing by an edge's coverage is what showed the band as a fringe along the letters. */
  it('leaves the band alone over an edge that is only partly covered', () => {
    const under = label(2, 0, 2, 1, () => [0, 0, 0, 128])
    expect(joinedPixels(own, ownLetters, 'outside', [under])).toBeNull()
  })

  it('keeps its own letters where they lie over the object under it', () => {
    const under = label(0, 0, 1, 1, () => INK)
    const out = joinedPixels(own, ownLetters, 'outside', [under])!
    expect(pixelAt(out, 0, 0)).toEqual(INK)
  })

  it('keeps a centred band inside its own letters, where it belongs to them', () => {
    const centred = label(0, 0, 2, 1, () => BAND)
    const letters = label(0, 0, 2, 1, (x) => (x === 0 ? INK : [0, 0, 0, 0]))
    const under = label(0, 0, 2, 1, () => INK)
    const out = joinedPixels(centred, letters, 'center', [under])!
    expect(pixelAt(out, 0, 0)).toEqual(BAND)
    expect(pixelAt(out, 1, 0)).toEqual([255, 255, 255, 0])
  })

  it('has nothing to keep off for an inside band, which never leaves its letters', () => {
    const under = label(0, 0, 4, 1, () => INK)
    expect(joinedPixels(own, ownLetters, 'inside', [under])).toBeNull()
  })

  it('draws as it is when nothing under it reaches it', () => {
    const under = label(10, 0, 2, 1, () => INK)
    expect(joinedPixels(own, ownLetters, 'outside', [under])).toBeNull()
  })
})
