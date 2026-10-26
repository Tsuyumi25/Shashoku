import { beforeEach, describe, expect, it } from 'vitest'
import type {
  EngineBitmap,
  EngineFontSource,
  EngineMeasure,
  EngineSpan,
  EngineStrokeSpec,
} from '@shared/engine/types'
import type { LayerEffect } from '@shared/effects/types'
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
  /** The runs the markup asked for, in the engine's own byte offsets. */
  spans?: readonly EngineSpan[]
  /** Which face got asked for, which is what resolution decides. */
  postscriptName?: string
}

let calls: DrawCall[] = []
let notdefCalls: DrawCall[] = []
let measureCalls: DrawCall[] = []
let notdefMeasureCalls: DrawCall[] = []

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
  font: EngineFontSource,
  text: string,
  _sizePx: number,
  _padding?: number,
  rotation?: number,
  _fillColor?: string,
  _stroke?: EngineStrokeSpec,
  phaseX?: number,
  phaseY?: number,
  align?: TextAlign,
  _weightPx?: number,
  spans?: EngineSpan[],
): EngineBitmap {
  calls.push({ text, rotation, phaseX, phaseY, align, spans, postscriptName: font.postscriptName })
  const size = turnedBitmap(BITMAP, rotation)
  return {
    ...size,
    baseline: 0,
    rgba: new Uint8Array(size.width * size.height * 4),
    clusters: [],
  }
}

function notdefSize(text: string, vertical?: boolean, rotation?: number) {
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((line) => [...line].length))
  const across = vertical ? lines.length : longest
  const down = vertical ? longest : lines.length
  return turnedBitmap({ width: across * NOTDEF_EM, height: down * NOTDEF_EM }, rotation)
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
  const size = notdefSize(text, vertical, rotation)
  return {
    ...size,
    baseline: 0,
    rgba: new Uint8Array(size.width * size.height * 4),
    clusters: [],
  }
}

function measureText(
  font: EngineFontSource,
  text: string,
  _sizePx: number,
  _padding?: number,
  rotation?: number,
  phaseX?: number,
  phaseY?: number,
  align?: TextAlign,
  spans?: EngineSpan[],
): EngineMeasure {
  measureCalls.push({
    text,
    rotation,
    phaseX,
    phaseY,
    align,
    spans,
    postscriptName: font.postscriptName,
  })
  return { ...turnedBitmap(BITMAP, rotation), baseline: 0, clusters: [] }
}

function measureNotdef(
  text: string,
  _sizePx: number,
  _padding?: number,
  vertical?: boolean,
  rotation?: number,
  phaseX?: number,
  phaseY?: number,
  align?: TextAlign,
): EngineMeasure {
  notdefMeasureCalls.push({ text, rotation, phaseX, phaseY, align })
  return { ...notdefSize(text, vertical, rotation), baseline: 0, clusters: [] }
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
      measureText,
      measureVertical: measureText,
      measureNotdef,
      uncoveredClusters: () => [],
    },
  },
})

function styleWith(patch: Partial<TextStyle> = {}): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, fontFamily: FAMILY, ...patch }
}

/** Nothing on top of the text: everything here is about how the text itself sets. */
const NONE: LayerEffect[] = []

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
    measureCalls = []
    notdefMeasureCalls = []
    catalog.value = [
      {
        family: FAMILY,
        displayName: FAMILY,
        style: 'Regular',
        postscriptName: 'TestFace-Regular',
        weight: 400,
        width: 100,
        slant: 0,
        origin: { kind: 'system', path: '/fonts/test.ttf', faceIndex: 0 },
      },
    ]
    catalogLoaded.value = true
  })

  it('hands the engine the fraction the page grid could not hold', () => {
    // Centred, where the odd 41-wide box leaves the corner on a half however
    // whole the position is.
    const drawn = drawnLabel(uniqueText(), styleWith({ align: 'center' }), NONE, { x: 100.25, y: 60 })

    expect(drawn.center.x - drawn.box.w / 2).toBe(79)
    expect(calls.at(-1)?.phaseX).toBe(0.75)
  })

  it('asks the engine to set the text the way the style says', () => {
    drawnLabel(uniqueText(), styleWith({ align: 'end' }), NONE, { x: 100, y: 60 })
    expect(calls.at(-1)?.align).toBe('end')
  })

  it('asks for the same alignment when there is no face to set it with', () => {
    catalog.value = []
    drawnLabel(uniqueText(), styleWith({ align: 'center' }), NONE, { x: 100, y: 60 })
    expect(notdefCalls.at(-1)?.align).toBe('center')
  })

  /**
   * What an alignment decides, seen from the outside: the notdef grid is one
   * cell per character, so a longer label is a wider one, and the edge that
   * does not move is the one it was aligned to.
   */
  describe('what stays put while a label grows', () => {
    const AT = { x: 100, y: 60 }
    const edges = (align: TextStyle['align'], text: string) => {
      catalog.value = []
      const drawn = drawnLabel(text, styleWith({ align }), NONE, AT)
      return { left: drawn.center.x - drawn.box.w / 2, right: drawn.center.x + drawn.box.w / 2 }
    }

    it('holds the left edge of a block set from the start', () => {
      expect(edges('start', 'ab').left).toBe(edges('start', 'abcd').left)
    })

    it('holds the right edge of a block set from the end', () => {
      expect(edges('end', 'ab').right).toBe(edges('end', 'abcd').right)
    })

    it('holds the middle of a centred block, growing to both sides', () => {
      const short = edges('center', 'ab')
      const long = edges('center', 'abcd')
      expect((short.left + short.right) / 2).toBe((long.left + long.right) / 2)
      expect(long.left).toBeLessThan(short.left)
    })

    /** Rows only ever stack downward, so the top is not the alignment's to move. */
    it('holds the top edge whichever way the lines are set', () => {
      const top = (align: TextStyle['align'], text: string) => {
        catalog.value = []
        const drawn = drawnLabel(text, styleWith({ align }), NONE, AT)
        return drawn.center.y - drawn.box.h / 2
      }
      for (const align of ['start', 'center', 'end'] as const) {
        expect(top(align, 'a')).toBe(top(align, 'a\nb'))
      }
    })
  })

  it('snaps the baseline, so nothing is asked for on the axis that stays whole', () => {
    drawnLabel(uniqueText(), styleWith(), NONE, { x: 100, y: 60.4 })
    expect(calls.at(-1)?.phaseY).toBe(0)
  })

  it('measures the frame before the phase, so the two cannot chase each other', () => {
    const first = drawnLabel(uniqueText(), styleWith(), NONE, { x: 100, y: 60 })
    const shifted = drawnLabel(uniqueText(), styleWith(), NONE, { x: 100.25, y: 60 })
    expect(shifted.box).toEqual(first.box)
  })

  it('asks once more than the cache already holds, not once per position', () => {
    const text = uniqueText()
    const style = styleWith()
    drawnLabel(text, style, NONE, { x: 100, y: 60 })
    const afterFirst = calls.length

    for (let i = 0; i < 40; i++) drawnLabel(text, style, NONE, { x: 100 + i / 40, y: 60 })

    // Four phases on the free axis, of which the first call already drew one.
    expect(calls.length - afterFirst).toBeLessThanOrEqual(3)
  })

  it('hands the phase to the engine in page pixels, unconverted', () => {
    drawnLabel(uniqueText(), styleWith({ align: 'center' }), NONE, { x: 100.25, y: 60 })
    // The odd box halves onto a quarter: 100.25 - 41/2 is 79.75, so 0.75 is
    // what is left once the corner lands on 79.
    expect(calls.at(-1)?.phaseX).toBeCloseTo(0.75, 9)
  })

  it('still places an empty label, which is what keeps it reachable', () => {
    const drawn = drawnLabel('', styleWith(), NONE, { x: 100.4, y: 60.4 })
    expect(drawn.sample).toBeNull()
    expect(drawn.missingFamily).toBeNull()
    expect(Number.isInteger(drawn.center.x - drawn.box.w / 2)).toBe(true)
  })

  it('draws the face the object names rather than the family representative', () => {
    catalog.value = [
      ...catalog.value,
      {
        family: FAMILY,
        displayName: FAMILY,
        style: 'Bold',
        postscriptName: 'TestFace-Bold',
        weight: 700,
        width: 100,
        slant: 0,
        origin: { kind: 'system', path: '/fonts/test-bold.ttf', faceIndex: 0 },
      },
    ]
    drawnLabel(
      uniqueText(),
      styleWith({ fontFace: 'TestFace-Bold', fontStyleName: 'Bold' }), NONE,
      { x: 10, y: 10 },
    )
    expect(calls.at(-1)?.postscriptName).toBe('TestFace-Bold')
  })

  it('falls back to the family where the named face is absent, not to boxes', () => {
    const drawn = drawnLabel(
      uniqueText(),
      styleWith({ fontFace: 'TestFace-Bold', fontStyleName: 'Bold' }), NONE,
      { x: 10, y: 10 },
    )
    expect(drawn.missingFamily).toBeNull()
    expect(calls.at(-1)?.postscriptName).toBe('TestFace-Regular')
    expect(notdefCalls).toHaveLength(0)
  })

  it('draws boxes for a family this machine does not have, and names the family', () => {
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), NONE, { x: 10, y: 10 })
    expect(drawn.sample).not.toBeNull()
    expect(drawn.missingFamily).toBe('Absent')
    expect(notdefCalls.length).toBeGreaterThan(0)
  })

  it('hands the engine the text, which is what the grid is shaped by', () => {
    const text = uniqueText()
    drawnLabel(text, styleWith({ fontFamily: 'Absent' }), NONE, { x: 10, y: 10 })
    expect(notdefCalls.at(-1)?.text).toBe(text)
  })

  it('frames one cell per character, so the frame is not a lone square', () => {
    const text = uniqueText()
    const drawn = drawnLabel(text, styleWith({ fontFamily: 'Absent' }), NONE, { x: 10, y: 10 })
    expect(drawn.box).toEqual({ w: text.length * NOTDEF_EM, h: NOTDEF_EM })
  })

  it('gives a second line a second row of cells', () => {
    const drawn = drawnLabel(`${uniqueText()}\nxy`, styleWith({ fontFamily: 'Absent' }), NONE, {
      x: 10,
      y: 10,
    })
    expect(drawn.box.h).toBe(2 * NOTDEF_EM)
  })

  it('turns the grid on its side for a vertical object', () => {
    const text = uniqueText()
    const drawn = drawnLabel(
      text,
      styleWith({ fontFamily: 'Absent', direction: 'vertical' }), NONE,
      { x: 10, y: 10 },
    )
    expect(drawn.box).toEqual({ w: NOTDEF_EM, h: text.length * NOTDEF_EM })
  })

  it('lands the grid on the page grid, as it does a run', () => {
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), NONE, {
      x: 100.25,
      y: 60,
    })
    expect(Number.isInteger(drawn.center.x - drawn.box.w / 2)).toBe(true)
    expect(notdefCalls.at(-1)?.phaseX).toBeCloseTo(0.25, 9)
  })

  /**
   * ⭐ Naming nothing and naming something absent look alike and are opposite.
   * A style that names no family is drawn in whatever this machine offers by
   * default — nobody has said anything for that to contradict. A style that
   * names a family this machine lacks is drawn as boxes however good a default
   * is to hand: the name is a fact about the project, and setting the page in
   * some other face would show a page typeset in a font it does not name.
   */
  it('draws a style that names no family in the default this machine offers', () => {
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: '' }), NONE, { x: 10, y: 10 })
    expect(drawn.missingFamily).toBeNull()
    expect(calls.at(-1)?.postscriptName).toBe('TestFace-Regular')
  })

  it('goes on drawing a family this machine lacks as boxes, default or no', () => {
    const absent = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), NONE, {
      x: 10,
      y: 10,
    })
    expect(absent.missingFamily).toBe('Absent')
    expect(notdefCalls.length).toBeGreaterThan(0)
  })

  /** Which leaves the boxes and the wording that goes with them, as before. */
  it('draws boxes for an unchosen family when this machine has nothing to offer', () => {
    catalog.value = []
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: '' }), NONE, { x: 10, y: 10 })
    expect(drawn.sample).not.toBeNull()
    expect(drawn.missingFamily).toBe('')
  })

  it('words the two cases differently', () => {
    expect(missingFamilyLabel('')).not.toContain('「')
    expect(missingFamilyLabel('Absent')).toContain('Absent')
  })

  it("hands the object's angle to the engine rather than turning the bitmap after", () => {
    const quarter = Math.PI / 2
    drawnLabel(uniqueText(), styleWith(), NONE, { x: 100, y: 60 }, quarter)
    expect(calls.at(-1)?.rotation).toBeCloseTo(quarter, 9)
  })

  it('asks upright once, so the frame measures the object and not its turn', () => {
    const drawn = drawnLabel(uniqueText(), styleWith(), NONE, { x: 100, y: 60 }, Math.PI / 2)
    // BITMAP is 41 x 20; a quarter turn makes the bitmap 20 x 41, but the box
    // is what the object measures standing up.
    expect(drawn.box).toEqual({ w: BITMAP.width, h: BITMAP.height })
    expect(measureCalls.some((call) => (call.rotation ?? 0) === 0)).toBe(true)
  })

  it('lands the turned bitmap on the grid, not the upright box', () => {
    const drawn = drawnLabel(uniqueText(), styleWith(), NONE, { x: 100, y: 60 }, Math.PI / 2)
    // The corner that gets blitted is the turned one, so it is that half-width
    // which has to come out whole.
    expect(Number.isInteger(drawn.center.x - BITMAP.height / 2)).toBe(true)
  })

  it('rasterizes only the bitmap it draws; the frame is measured', () => {
    const text = uniqueText()
    drawnLabel(text, styleWith(), NONE, { x: 100.25, y: 60 })
    // At zero the turned pass is the same question as the upright one, so one
    // measure answers both.
    expect(calls).toHaveLength(1)
    expect(measureCalls).toHaveLength(1)
  })

  it('rasterizes once even turned, where the turn used to cost two more', () => {
    drawnLabel(uniqueText(), styleWith(), NONE, { x: 100.25, y: 60 }, Math.PI / 3)
    expect(calls).toHaveLength(1)
    // Upright for the frame, turned for the blit.
    expect(measureCalls).toHaveLength(2)
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
      drawnLabel(uniqueText(), styleWith(), NONE, ANCHOR, rotation)
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
    const drawn = drawnLabel(uniqueText(), styleWith({ fontFamily: 'Absent' }), NONE, { x: 10, y: 10 })
    expect(drawn.sample).toBeNull()
    expect(drawn.missingFamily).toBeNull()
    expect(notdefCalls).toHaveLength(0)
  })

  /**
   * What a body stores is markup code, and what gets set is the words left
   * once the tags are read. Everything here is about that seam: the engine
   * must never be handed a tag, and the runs the tags describe have to arrive
   * in the offsets the engine counts in.
   */
  describe('markup', () => {
    it('sets the words rather than the code they are written in', () => {
      const text = uniqueText()
      const drawn = drawnLabel(`<size=×2>${text}</size>`, styleWith(), NONE, { x: 10, y: 10 })
      expect(drawn.plain).toBe(text)
      expect(calls.at(-1)?.text).toBe(text)
    })

    it('sets an escaped angle bracket as the character it stands for', () => {
      const text = uniqueText()
      const drawn = drawnLabel(`&lt;${text}&amp;`, styleWith(), NONE, { x: 10, y: 10 })
      expect(drawn.plain).toBe(`<${text}&`)
      expect(calls.at(-1)?.text).toBe(`<${text}&`)
    })

    it('counts a span in the bytes the engine counts in, not in string units', () => {
      // 'あ' is three bytes, so a tag that starts on the second character
      // starts at byte three — the one conversion this layer owns.
      drawnLabel(`あ<size=×2>${uniqueText()}</size>`, styleWith(), NONE, { x: 10, y: 10 })
      expect(calls.at(-1)?.spans?.[0]?.start).toBe(3)
    })

    it('resolves a relative size against the object own size', () => {
      const style = styleWith({ fontSizePx: 40 })
      drawnLabel(`<size=×1.5>${uniqueText()}</size>`, style, NONE, { x: 10, y: 10 })
      expect(calls.at(-1)?.spans?.[0]?.sizePx).toBe(60)
    })

    it('asks for no spans at all for a body with no tags in it', () => {
      // Which is what keeps an untagged object on the same cache key, and the
      // same bitmap, as before there was any markup.
      drawnLabel(uniqueText(), styleWith(), NONE, { x: 10, y: 10 })
      expect(calls.at(-1)?.spans).toBeUndefined()
    })

    it('measures the frame with the spans, since a size moves what it fits', () => {
      drawnLabel(`<size=×2>${uniqueText()}</size>`, styleWith(), NONE, { x: 10, y: 10 })
      expect(measureCalls.at(-1)?.spans?.length).toBe(1)
    })

    it('draws nothing for a body that is all tags and no words', () => {
      const drawn = drawnLabel('<size=×2></size>', styleWith(), NONE, { x: 10, y: 10 })
      expect(drawn.plain).toBe('')
      expect(drawn.sample).toBeNull()
    })

    it('shapes the notdef grid from the words, not from the tags round them', () => {
      const text = uniqueText()
      const drawn = drawnLabel(
        `<color=#ff0000>${text}</color>`,
        styleWith({ fontFamily: 'Absent' }),
        NONE,
        { x: 10, y: 10 },
      )
      expect(drawn.box).toEqual({ w: text.length * NOTDEF_EM, h: NOTDEF_EM })
    })
  })
})
