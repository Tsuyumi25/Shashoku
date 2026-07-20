import { describe, expect, it } from 'vitest'
import {
  defaultManifest,
  defaultOcr,
  defaultTranslation,
  PageParseError,
  parseManifest,
  parseOcr,
  parseTranslation,
  serializeManifest,
  serializeOcr,
  serializeTranslation,
} from './schema'
import {
  MANIFEST_SCHEMA_VERSION,
  OCR_SCHEMA_VERSION,
  TRANSLATION_SCHEMA_VERSION,
  type ManifestJson,
  type OcrJson,
  type TranslationJson,
} from './types'

// 註:BLEND_MODE_ALLOWLIST 與 src/engine/blend.ts BLEND_MODES 的一致性
// 由 src/engine/blend.test.ts 驗證(shared/ 不允許反向依賴 src/,以 tsconfig
// 隔離為準)。

// ── manifest.json ──

describe('manifest.json', () => {
  it('defaultManifest 為空 layers,revision 從 0 開始', () => {
    expect(defaultManifest()).toEqual({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      layers: [],
    })
  })

  it('roundtrip: 含多層', () => {
    const m: ManifestJson = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 7,
      layers: [
        {
          id: 'l1',
          file: 'background.png',
          name: '底圖',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
        {
          id: 'l2',
          file: 'redraw.png',
          name: '清稿',
          visible: true,
          opacity: 0.75,
          blendMode: 'multiply',
          locked: false,
          alphaLocked: true,
        },
      ],
    }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })

  it('layers 必須是陣列', () => {
    expect(() =>
      parseManifest(JSON.stringify({ schemaVersion: 1, layers: {} })),
    ).toThrow(/必須是陣列/)
  })

  it('layer.file 不可含路徑分隔符', () => {
    const bad = {
      schemaVersion: 1,
      layers: [
        {
          id: 'x',
          file: '../evil.png',
          name: '',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/不可含路徑/)
  })

  it('layer.file 重複抛錯', () => {
    const bad = {
      schemaVersion: 1,
      layers: [
        {
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
        {
          id: 'b',
          file: 'x.png',
          name: '',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/不可重複/)
  })

  it('未知 blendMode 抛錯', () => {
    const bad = {
      schemaVersion: 1,
      layers: [
        {
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          opacity: 1,
          blendMode: 'divine-light',
          locked: false,
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/blendMode/)
  })

  it('opacity 超出 [0,1] 抛錯', () => {
    const bad = {
      schemaVersion: 1,
      layers: [
        {
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          opacity: 1.5,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/opacity/)
  })

  it('schemaVersion 較新抛「請更新軟體」', () => {
    expect(() => parseManifest('{"schemaVersion":999,"layers":[]}')).toThrow(/請更新軟體/)
  })

  it('缺 revision 欄位視為 0(向前相容舊 manifest)', () => {
    const legacy = JSON.stringify({ schemaVersion: 1, layers: [] })
    const parsed = parseManifest(legacy)
    expect(parsed.revision).toBe(0)
  })

  it('revision 負數或非整數抛錯', () => {
    const bad1 = JSON.stringify({ schemaVersion: 1, revision: -1, layers: [] })
    expect(() => parseManifest(bad1)).toThrow(/revision/)
    const bad2 = JSON.stringify({ schemaVersion: 1, revision: 1.5, layers: [] })
    expect(() => parseManifest(bad2)).toThrow(/revision/)
  })

  it('缺 id 會補一個(向前相容手寫檔案)', () => {
    const noId = {
      schemaVersion: 1,
      layers: [
        {
          file: 'x.png',
          name: '',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          alphaLocked: false,
        },
      ],
    }
    const parsed = parseManifest(JSON.stringify(noId))
    expect(parsed.layers[0].id).toBeTruthy()
    expect(parsed.layers[0].id.length).toBeGreaterThan(0)
  })
})

// ── translation.json ──

describe('translation.json', () => {
  it('defaultTranslation 空 labels', () => {
    expect(defaultTranslation()).toEqual({
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [],
    })
  })

  it('roundtrip: 多 label', () => {
    const t: TranslationJson = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [
        { id: 'a', x: 0.5, y: 0.3, category: 1, lines: ['Hi', 'there'] },
        { id: 'b', x: 0.1, y: 0.9, category: 2, lines: ['bang!'] },
      ],
    }
    expect(parseTranslation(serializeTranslation(t))).toEqual(t)
  })

  it('groupCount 傳入時嚴格驗證 category 上限', () => {
    const t: TranslationJson = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ id: 'a', x: 0, y: 0, category: 5, lines: [] }],
    }
    const raw = serializeTranslation(t)
    expect(() => parseTranslation(raw, 3)).toThrow(/超出目前 groups 數量/)
    expect(() => parseTranslation(raw, null)).not.toThrow()
  })

  it('lines 內嵌換行抛錯', () => {
    const bad = {
      schemaVersion: 1,
      labels: [{ id: 'a', x: 0, y: 0, category: 1, lines: ['a\nb'] }],
    }
    expect(() => parseTranslation(JSON.stringify(bad))).toThrow(/不可內嵌換行/)
  })

  it('缺 id 會補一個', () => {
    const noId = {
      schemaVersion: 1,
      labels: [{ x: 0, y: 0, category: 1, lines: ['hi'] }],
    }
    const parsed = parseTranslation(JSON.stringify(noId))
    expect(parsed.labels[0].id).toBeTruthy()
  })
})

// ── ocr.json ──

describe('ocr.json', () => {
  it('defaultOcr 記錄尺寸', () => {
    expect(defaultOcr(1200, 800)).toEqual({
      schemaVersion: OCR_SCHEMA_VERSION,
      width: 1200,
      height: 800,
      blocks: [],
    })
  })

  it('roundtrip 含 text', () => {
    const o: OcrJson = {
      schemaVersion: OCR_SCHEMA_VERSION,
      width: 1200,
      height: 800,
      blocks: [
        { x: 10, y: 20, w: 100, h: 50, label: 'text_bubble', score: 0.95, text: 'こんにちは' },
        { x: 200, y: 300, w: 80, h: 40, label: 'bubble', score: 0.7 },
      ],
    }
    expect(parseOcr(serializeOcr(o))).toEqual(o)
  })

  it('width 非正數抛錯', () => {
    const bad = JSON.stringify({ schemaVersion: 1, width: 0, height: 100, blocks: [] })
    expect(() => parseOcr(bad)).toThrow(/width/)
  })

  it('未知 label 抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      width: 100,
      height: 100,
      blocks: [{ x: 0, y: 0, w: 10, h: 10, label: 'signature', score: 0.5 }],
    })
    expect(() => parseOcr(bad)).toThrow(/label/)
  })
})

describe('共同錯誤情境', () => {
  it('非 JSON 抛 PageParseError', () => {
    expect(() => parseManifest('nope')).toThrow(PageParseError)
    expect(() => parseTranslation('nope')).toThrow(PageParseError)
    expect(() => parseOcr('nope')).toThrow(PageParseError)
  })

  it('BOM 開頭仍能解析', () => {
    const m = defaultManifest()
    const withBom = '﻿' + serializeManifest(m)
    expect(() => parseManifest(withBom)).not.toThrow()
  })
})
