import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineBitmap, EngineFontSource, EngineMeasure } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { measureFor, sampleFor } from './fontSampleCache'

/** Matches CACHE_LIMIT in the module under test. */
const SAMPLE_LIMIT = 240

let renderCalls: string[] = []
let measureCalls: string[] = []

function renderText(_font: EngineFontSource, text: string): EngineBitmap {
  renderCalls.push(text)
  return { width: 8, height: 8, baseline: 0, rgba: new Uint8Array(8 * 8 * 4), clusters: [] }
}

function measureText(_font: EngineFontSource, text: string): EngineMeasure {
  measureCalls.push(text)
  return { width: 8, height: 8, baseline: 0, clusters: [] }
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
      measureText,
      measureVertical: measureText,
      uncoveredClusters: () => [],
    },
  },
})

const ENTRY: FontEntry = {
  family: 'Test Face',
  displayName: 'Test Face',
  style: 'Regular',
  postscriptName: 'TestFace-Regular',
  weight: 400,
  width: 100,
  slant: 0,
  origin: { kind: 'system', path: '/fonts/test.ttf', faceIndex: 0 },
}

function ask(text: string) {
  return sampleFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#000000' })
}

/** Fresh text per test, so one test's entries cannot answer for another's. */
let serial = 0
function uniqueText(): string {
  serial += 1
  return `cache-${serial}`
}

describe('the sample cache', () => {
  beforeEach(() => {
    renderCalls = []
    measureCalls = []
  })

  it('answers a repeat from the cache, not the engine', () => {
    const text = uniqueText()
    ask(text)
    ask(text)
    expect(renderCalls.filter((t) => t === text)).toHaveLength(1)
  })

  it('evicts the least recently used entry, not the most', () => {
    const kept = uniqueText()
    const dropped = uniqueText()
    ask(kept)
    ask(dropped)
    for (let i = 0; i < SAMPLE_LIMIT - 2; i++) ask(uniqueText())

    // Touching the oldest entry moves it to the young end, so the overflow
    // that follows lands on the untouched one instead.
    ask(kept)
    ask(uniqueText())

    ask(kept)
    expect(renderCalls.filter((t) => t === kept)).toHaveLength(1)
    ask(dropped)
    expect(renderCalls.filter((t) => t === dropped)).toHaveLength(2)
  })
})

describe('the measure cache', () => {
  beforeEach(() => {
    measureCalls = []
  })

  it('answers a repeat from the cache, not the engine', () => {
    const text = uniqueText()
    measureFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#000000' })
    measureFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#000000' })
    expect(measureCalls.filter((t) => t === text)).toHaveLength(1)
  })

  it('keys on geometry, so a recolour is not a second measurement', () => {
    const text = uniqueText()
    measureFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#000000' })
    measureFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#ff0000' })
    expect(measureCalls.filter((t) => t === text)).toHaveLength(1)
  })

  it('re-measures when the padding-shaping inputs change', () => {
    const text = uniqueText()
    measureFor({ entry: ENTRY, text, sizePx: 16, fillColor: '#000000' })
    measureFor({
      entry: ENTRY,
      text,
      sizePx: 16,
      fillColor: '#000000',
      stroke: { width: 3, color: '#ffffff' },
    })
    expect(measureCalls.filter((t) => t === text)).toHaveLength(2)
  })
})
