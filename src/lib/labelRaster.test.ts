import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineBitmap, EngineFontSource, EngineStrokeSpec } from '@shared/engine/types'
import { DEFAULT_TEXT_STYLE, type TextAlign, type TextStyle } from '@shared/text-style/types'
import { catalog, catalogLoaded } from './fontCatalog'
import { drawnLabel, missingFamilyLabel } from './labelRaster'

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
  rotation?: number
  phaseX?: number
  phaseY?: number
  align?: TextAlign
}

let calls: DrawCall[] = []
let notdefCalls: DrawCall[] = []

/**
 * A quarter turn swaps the sides, as the engine's own does. Anything else is
 * left alone: these tests are about what gets asked for, not about geometry
 * the engine already has its own tests for.
 */
function turnedBitmap(size: { width: number; height: number }, rotation?: number) {
  const quarter = Math.abs(Math.round((rotation ?? 0) / (Math.PI / 2))) % 2 === 1
  return quarter ? { width: size.height, height: size.width } : size
}

function renderText(
  _font: EngineFontSource,
  text: string,
  _sizePx: number,
  _padding?: number,
  rotation?: number,
  _fillColor?: string,
  _stroke?: EngineStrokeSpec,
  phaseX?: number,
  phaseY?: number,
  align?: TextAlign,
): EngineBitmap {
  calls.push({ text, rotation, phaseX, phaseY, align })
  const size = turnedBitmap(BITMAP, rotation)
  return {
    ...size,
    baseline: 0,
    rgba: new Uint8Array(size.width * size.height * 4),
    clusters: [],
  }
}

function renderNotdef(
  text: string,
  _sizePx: number,
  _padding?: number,
  vertical?: boolean,
  rotation?: number,
  _fillColor?: string,
  _stroke?: EngineStrokeSpec,
  phaseX?: number,
  phaseY?: number,
  align?: TextAlign,
): EngineBitmap {
  notdefCalls.push({ text, rotation, phaseX, phaseY, align })
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((line) => [...line].length))
  const across = vertical ? lines.length : longest
  const down = vertical ? longest : lines.length
  const size = turnedBitmap(
    { width: across * NOTDEF_EM, height: down * NOTDEF_EM },
    rotation,
  )
  return {
    ...size,
    baseline: 0,
    rgba: new Uint8Array(size.width * size.height * 4),
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

  it('asks the engine to set the text the way the style says', () => {
    drawnLabel(uniqueText(), styleWith({ align: 'end' }), { x: 100, y: 60 })
    expect(calls.at(-1)?.align).toBe('end')
  })

  it('asks for the same alignment when there is no face to set it with', () => {
    catalog.value = []
    drawnLabel(uniqueText(), styleWith({ align: 'center' }), { x: 100, y: 60 })
    expect(notdefCalls.at(-1)?.align).toBe('center')
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

  it('tells an unchosen family apart from a family this machine lacks', () => {
    // Both draw boxes, but only one of them is the user's next move, so the
    // two cannot collapse into the same value.
    const unchosen = drawnLabel(uniqueText(), styleWith({ fontFamily: '' }), { x: 10, y: 10 })
    expect(unchosen.sample).not.toBeNull()
    expect(unchosen.missingFamily).toBe('')

    const absent = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), { x: 10, y: 10 })
    expect(absent.missingFamily).toBe('Absent')
  })

  it('words the two cases differently', () => {
    expect(missingFamilyLabel('')).not.toContain('「')
    expect(missingFamilyLabel('Absent')).toContain('Absent')
  })

  it("hands the object's angle to the engine rather than turning the bitmap after", () => {
    const quarter = Math.PI / 2
    drawnLabel(uniqueText(), styleWith(), { x: 100, y: 60 }, quarter)
    expect(calls.at(-1)?.rotation).toBeCloseTo(quarter, 9)
  })

  it('asks upright once, so the frame measures the object and not its turn', () => {
    const drawn = drawnLabel(uniqueText(), styleWith(), { x: 100, y: 60 }, Math.PI / 2)
    // BITMAP is 41 x 20; a quarter turn makes the bitmap 20 x 41, but the box
    // is what the object measures standing up.
    expect(drawn.box).toEqual({ w: BITMAP.width, h: BITMAP.height })
    expect(calls.some((call) => (call.rotation ?? 0) === 0)).toBe(true)
  })

  it('lands the turned bitmap on the grid, not the upright box', () => {
    const drawn = drawnLabel(uniqueText(), styleWith(), { x: 100, y: 60 }, Math.PI / 2)
    // The corner that gets blitted is the turned one, so it is that half-width
    // which has to come out whole.
    expect(Number.isInteger(drawn.center.x - BITMAP.height / 2)).toBe(true)
  })

  it('costs an upright label exactly what it did before', () => {
    const text = uniqueText()
    drawnLabel(text, styleWith(), { x: 100, y: 60 })
    // Measure and draw. At zero the turned pass is the same request as the
    // upright one, so it lands on the cache instead of the engine.
    expect(calls).toHaveLength(2)
  })

  describe('the snapped axis follows the turn', () => {
    /**
     * Chosen so a quarter-step axis lands on a quarter and a whole-step one
     * lands on zero, for both the upright 41x20 bitmap and the 20x41 a quarter
     * turn makes of it. A phase of zero is only evidence of snapping if the
     * fine step would not have produced one anyway.
     */
    const ANCHOR = { x: 100.25, y: 60.25 }

    /** Which axis came back whole, which is the one that got snapped. */
    function snapped(rotation: number) {
      drawnLabel(uniqueText(), styleWith(), ANCHOR, rotation)
      const call = calls.at(-1)
      return { x: call?.phaseX === 0, y: call?.phaseY === 0 }
    }

    it('snaps Y upright, where the horizontal strokes lie along a row', () => {
      expect(snapped(0)).toEqual({ x: false, y: true })
    })

    it('still snaps Y at a half turn, which leaves them lying along a row', () => {
      expect(snapped(Math.PI)).toEqual({ x: false, y: true })
    })

    it('snaps X at a quarter turn, which stands them up into a column', () => {
      expect(snapped(Math.PI / 2)).toEqual({ x: true, y: false })
    })

    it('snaps neither off the axes, where the strokes align with nothing', () => {
      expect(snapped(Math.PI / 4)).toEqual({ x: false, y: false })
    })
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
