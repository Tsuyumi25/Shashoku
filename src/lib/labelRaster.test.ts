import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineBitmap, EngineFontSource, EngineStrokeSpec } from '@shared/engine/types'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { catalog, catalogLoaded } from './fontCatalog'
import { drawnLabel } from './labelRaster'

const FAMILY = 'Test Face'

/**
 * The bitmap's size comes from the font's metrics, so it does not follow the
 * phase — the real engine moves the run inside a bitmap it has already
 * measured. `drawnLabel` measures the frame from a bitmap and then derives the
 * phase from that frame, which is only sound if this stays true.
 */
const BITMAP = { width: 41, height: 20 }

/**
 * The notdef grid is one square cell per character, so its size follows the
 * text — the same way a run's does, which is what keeps the frame honest.
 */
const NOTDEF_EM = 32

interface DrawCall {
  text: string
  phaseX?: number
  phaseY?: number
}

let calls: DrawCall[] = []
let notdefCalls: DrawCall[] = []

function renderText(
  _font: EngineFontSource,
  text: string,
  _sizePx: number,
  _padding?: number,
  _fillColor?: string,
  _stroke?: EngineStrokeSpec,
  phaseX?: number,
  phaseY?: number,
): EngineBitmap {
  calls.push({ text, phaseX, phaseY })
  return {
    ...BITMAP,
    baseline: 0,
    rgba: new Uint8Array(BITMAP.width * BITMAP.height * 4),
    clusters: [],
  }
}

function renderNotdef(
  text: string,
  _sizePx: number,
  _padding?: number,
  vertical?: boolean,
  _fillColor?: string,
  _stroke?: EngineStrokeSpec,
  phaseX?: number,
  phaseY?: number,
): EngineBitmap {
  notdefCalls.push({ text, phaseX, phaseY })
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((line) => [...line].length))
  const across = vertical ? lines.length : longest
  const down = vertical ? longest : lines.length
  return {
    width: across * NOTDEF_EM,
    height: down * NOTDEF_EM,
    baseline: 0,
    rgba: new Uint8Array(across * down * NOTDEF_EM * NOTDEF_EM * 4),
    clusters: [],
  }
}

class StubImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

Object.assign(globalThis, {
  ImageData: StubImageData,
  window: {
    engine: {
      renderText,
      renderVertical: renderText,
      renderNotdef,
      uncoveredClusters: () => [],
    },
  },
})

function styleWith(patch: Partial<TextStyle> = {}): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, fontFamily: FAMILY, ...patch }
}

/** Fresh text per call, so the sample cache never answers for a previous one. */
let serial = 0
function uniqueText(): string {
  serial += 1
  return `run-${serial}`
}

describe('drawnLabel', () => {
  beforeEach(() => {
    calls = []
    notdefCalls = []
    catalog.value = [
      {
        family: FAMILY,
        displayName: FAMILY,
        style: 'Regular',
        origin: { kind: 'system', path: '/fonts/test.ttf', faceIndex: 0 },
      },
    ]
    catalogLoaded.value = true
  })

  it('hands the engine the fraction the page grid could not hold', () => {
    // The box is 41 wide, so a whole anchor already leaves the corner on a half.
    const drawn = drawnLabel(uniqueText(), styleWith(), { x: 100.25, y: 60 })

    expect(drawn.center.x - drawn.box.w / 2).toBe(79)
    expect(calls.at(-1)?.phaseX).toBe(0.75)
  })

  it('snaps the baseline, so nothing is asked for on the axis that stays whole', () => {
    drawnLabel(uniqueText(), styleWith(), { x: 100, y: 60.4 })
    expect(calls.at(-1)?.phaseY).toBe(0)
  })

  it('measures the frame before the phase, so the two cannot chase each other', () => {
    const first = drawnLabel(uniqueText(), styleWith(), { x: 100, y: 60 })
    const shifted = drawnLabel(uniqueText(), styleWith(), { x: 100.25, y: 60 })
    expect(shifted.box).toEqual(first.box)
  })

  it('asks once more than the cache already holds, not once per position', () => {
    const text = uniqueText()
    const style = styleWith()
    drawnLabel(text, style, { x: 100, y: 60 })
    const afterFirst = calls.length

    for (let i = 0; i < 40; i++) drawnLabel(text, style, { x: 100 + i / 40, y: 60 })

    // Four phases on the free axis, one of which the measuring pass already
    // rasterized.
    expect(calls.length - afterFirst).toBeLessThanOrEqual(4)
  })

  it('hands the phase to the engine in page pixels, unconverted', () => {
    drawnLabel(uniqueText(), styleWith(), { x: 100.25, y: 60 })
    // The odd box halves onto a quarter: 100.25 - 41/2 is 79.75, so 0.75 is
    // what is left once the corner lands on 79.
    expect(calls.at(-1)?.phaseX).toBeCloseTo(0.75, 9)
  })

  it('still places an empty label, which is what keeps it reachable', () => {
    const drawn = drawnLabel('', styleWith(), { x: 100.4, y: 60.4 })
    expect(drawn.sample).toBeNull()
    expect(drawn.missingFamily).toBeNull()
    expect(Number.isInteger(drawn.center.x - drawn.box.w / 2)).toBe(true)
  })

  it('draws boxes for a family this machine does not have, and names the family', () => {
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), { x: 10, y: 10 })
    expect(drawn.sample).not.toBeNull()
    expect(drawn.missingFamily).toBe('Absent')
    expect(notdefCalls.length).toBeGreaterThan(0)
  })

  it('hands the engine the text, which is what the grid is shaped by', () => {
    const text = uniqueText()
    drawnLabel(text, styleWith({ fontFamily: 'Absent' }), { x: 10, y: 10 })
    expect(notdefCalls.at(-1)?.text).toBe(text)
  })

  it('frames one cell per character, so the frame is not a lone square', () => {
    const text = uniqueText()
    const drawn = drawnLabel(text, styleWith({ fontFamily: 'Absent' }), { x: 10, y: 10 })
    expect(drawn.box).toEqual({ w: text.length * NOTDEF_EM, h: NOTDEF_EM })
  })

  it('gives a second line a second row of cells', () => {
    const drawn = drawnLabel(`${uniqueText()}\nxy`, styleWith({ fontFamily: 'Absent' }), {
      x: 10,
      y: 10,
    })
    expect(drawn.box.h).toBe(2 * NOTDEF_EM)
  })

  it('turns the grid on its side for a vertical object', () => {
    const text = uniqueText()
    const drawn = drawnLabel(
      text,
      styleWith({ fontFamily: 'Absent', direction: 'vertical' }),
      { x: 10, y: 10 },
    )
    expect(drawn.box).toEqual({ w: NOTDEF_EM, h: text.length * NOTDEF_EM })
  })

  it('lands the grid on the page grid, as it does a run', () => {
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), {
      x: 100.25,
      y: 60,
    })
    expect(Number.isInteger(drawn.center.x - drawn.box.w / 2)).toBe(true)
    expect(notdefCalls.at(-1)?.phaseX).toBeCloseTo(0.25, 9)
  })

  it('draws nothing while the catalogue is still being enumerated', () => {
    // Not yet answered is not the same as absent, and a box that appeared for
    // half a second on every start would say the wrong one.
    catalogLoaded.value = false
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), { x: 10, y: 10 })
    expect(drawn.sample).toBeNull()
    expect(drawn.missingFamily).toBeNull()
    expect(notdefCalls).toHaveLength(0)
  })
})
