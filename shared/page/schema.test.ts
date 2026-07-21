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
  type GroupLayerEntry,
  type ManifestJson,
  type OcrJson,
  type RasterLayerEntry,
  type TextLayerEntry,
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

  it('roundtrip: 混合 raster / text / group(nested)', () => {
    const m: ManifestJson = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 7,
      layers: [
        {
          kind: 'raster',
          id: 'l1',
          file: 'background.png',
          name: '底圖',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLocked: false,
        },
        {
          kind: 'group',
          id: 'g-dialog',
          name: '対白',
          visible: true,
          locked: false,
          styleBinding: { labelGroupId: 'grp-dialog' },
          children: [
            {
              kind: 'text',
              id: 't-1',
              name: '',
              visible: true,
              locked: false,
              labelId: 'label-a',
            },
          ],
        },
        {
          kind: 'raster',
          id: 'l2',
          file: 'redraw.png',
          name: '清稿',
          visible: true,
          locked: false,
          opacity: 0.75,
          blendMode: 'multiply',
          alphaLocked: true,
        },
      ],
    }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })

  it('layers 必須是陣列', () => {
    expect(() =>
      parseManifest(JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, layers: {} })),
    ).toThrow(/必須是陣列/)
  })

  it('缺 kind 或未知 kind 抛錯', () => {
    const noKind = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [{ id: 'x', name: '', visible: true, locked: false, file: 'a.png', opacity: 1, blendMode: 'normal', alphaLocked: false }],
    }
    expect(() => parseManifest(JSON.stringify(noKind))).toThrow(/kind/)
    const bogus = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [{ kind: 'bogus', id: 'x', name: '', visible: true, locked: false }],
    }
    expect(() => parseManifest(JSON.stringify(bogus))).toThrow(/kind/)
  })

  it('raster.file 不可含路徑分隔符', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'raster',
          id: 'x',
          file: '../evil.png',
          name: '',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/不可含路徑/)
  })

  it('raster.file 重複抛錯(包含 nested group 內的 raster)', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'raster',
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLocked: false,
        },
        {
          kind: 'group',
          id: 'g',
          name: '',
          visible: true,
          locked: false,
          children: [
            {
              kind: 'raster',
              id: 'b',
              file: 'x.png',
              name: '',
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: 'normal',
              alphaLocked: false,
            },
          ],
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/不可重複/)
  })

  it('未知 blendMode 抛錯', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'raster',
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'divine-light',
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/blendMode/)
  })

  it('opacity 超出 [0,1] 抛錯', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'raster',
          id: 'a',
          file: 'x.png',
          name: '',
          visible: true,
          locked: false,
          opacity: 1.5,
          blendMode: 'normal',
          alphaLocked: false,
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/opacity/)
  })

  it('schemaVersion 較新抛「請更新軟體」', () => {
    expect(() => parseManifest('{"schemaVersion":999,"layers":[]}')).toThrow(/請更新軟體/)
  })

  it('v1 manifest 讀不進來(POC 硬斷)', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      layers: [{ id: 'a', file: 'x.png', name: '', visible: true, opacity: 1, blendMode: 'normal', locked: false, alphaLocked: false }],
    })
    expect(() => parseManifest(v1)).toThrow(/v2 以下/)
  })

  it('缺 revision 欄位視為 0', () => {
    const legacy = JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, layers: [] })
    const parsed = parseManifest(legacy)
    expect(parsed.revision).toBe(0)
  })

  it('revision 負數或非整數抛錯', () => {
    const bad1 = JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, revision: -1, layers: [] })
    expect(() => parseManifest(bad1)).toThrow(/revision/)
    const bad2 = JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 1.5, layers: [] })
    expect(() => parseManifest(bad2)).toThrow(/revision/)
  })

  it('缺 id 會補一個(向前相容手寫檔案)', () => {
    const noId = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'raster',
          file: 'x.png',
          name: '',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLocked: false,
        },
      ],
    }
    const parsed = parseManifest(JSON.stringify(noId))
    expect(parsed.layers[0].id).toBeTruthy()
    expect(parsed.layers[0].id.length).toBeGreaterThan(0)
  })

  it('text layer 需要 labelId', () => {
    const noLabel = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [{ kind: 'text', id: 't', name: '', visible: true, locked: false }],
    }
    expect(() => parseManifest(JSON.stringify(noLabel))).toThrow(/labelId/)

    const emptyLabel = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [{ kind: 'text', id: 't', name: '', visible: true, locked: false, labelId: '' }],
    }
    expect(() => parseManifest(JSON.stringify(emptyLabel))).toThrow(/labelId/)
  })

  it('group.styleBinding 選用;缺失也能 roundtrip(一般 group)', () => {
    const plainGroup: GroupLayerEntry = {
      kind: 'group',
      id: 'g',
      name: '自由群組',
      visible: true,
      locked: false,
      children: [],
    }
    const m: ManifestJson = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      layers: [plainGroup],
    }
    const parsed = parseManifest(serializeManifest(m))
    expect(parsed.layers[0]).toEqual(plainGroup)
    // 缺 styleBinding 的 group 不會在 serialized JSON 生出 styleBinding 欄位
    expect(serializeManifest(m)).not.toContain('styleBinding')
  })

  it('group.styleBinding.labelGroupId 非空字串限制', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'group',
          id: 'g',
          name: '',
          visible: true,
          locked: false,
          children: [],
          styleBinding: { labelGroupId: '' },
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/labelGroupId/)
  })

  it('nested group children 遞迴驗證(子節點的 blendMode 錯抛在 children 路徑)', () => {
    const bad = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      layers: [
        {
          kind: 'group',
          id: 'g',
          name: '',
          visible: true,
          locked: false,
          children: [
            {
              kind: 'raster',
              id: 'r',
              file: 'x.png',
              name: '',
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: 'divine-light',
              alphaLocked: false,
            },
          ],
        },
      ],
    }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/layers\[0\]\.children\[0\]\.blendMode/)
  })

  it('三種 kind 型別 alias 都可獨立構造', () => {
    const r: RasterLayerEntry = {
      kind: 'raster',
      id: 'r',
      name: '',
      visible: true,
      locked: false,
      file: 'x.png',
      opacity: 1,
      blendMode: 'normal',
      alphaLocked: false,
    }
    const t: TextLayerEntry = { kind: 'text', id: 't', name: '', visible: true, locked: false, labelId: 'a' }
    const g: GroupLayerEntry = { kind: 'group', id: 'g', name: '', visible: true, locked: false, children: [r, t] }
    const m: ManifestJson = { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, layers: [g] }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
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

  it('roundtrip: 多 label(groupId + styleOverride)', () => {
    const t: TranslationJson = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [
        { id: 'a', x: 0.5, y: 0.3, groupId: 'grp-x', lines: ['Hi', 'there'] },
        {
          id: 'b',
          x: 0.1,
          y: 0.9,
          groupId: null,
          lines: ['bang!'],
          styleOverride: { fontSizePx: 42, color: '#ff0000' },
        },
      ],
    }
    expect(parseTranslation(serializeTranslation(t))).toEqual(t)
  })

  it('validGroupIds 傳入時嚴格驗證 groupId 有效', () => {
    const t: TranslationJson = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ id: 'a', x: 0, y: 0, groupId: 'grp-unknown', lines: [] }],
    }
    const raw = serializeTranslation(t)
    expect(() => parseTranslation(raw, ['grp-a', 'grp-b'])).toThrow(/不在目前 project.groups/)
    expect(() => parseTranslation(raw, null)).not.toThrow()
  })

  it('lines 內嵌換行抛錯', () => {
    const bad = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ id: 'a', x: 0, y: 0, groupId: null, lines: ['a\nb'] }],
    }
    expect(() => parseTranslation(JSON.stringify(bad))).toThrow(/不可內嵌換行/)
  })

  it('缺 id 會補一個', () => {
    const noId = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ x: 0, y: 0, groupId: null, lines: ['hi'] }],
    }
    const parsed = parseTranslation(JSON.stringify(noId))
    expect(parsed.labels[0].id).toBeTruthy()
  })

  it('舊 anchorLayerId 欄位被忽略(C2 退役,由 LetterMode 依 label 現況重建 tree 位置)', () => {
    const raw = JSON.stringify({
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ id: 'a', x: 0.1, y: 0.2, groupId: null, lines: ['x'], anchorLayerId: 'legacy' }],
    })
    const back = parseTranslation(raw)
    expect(back.labels[0]).not.toHaveProperty('anchorLayerId')
    // serialize 也不會把它帶回去
    expect(serializeTranslation(back)).not.toContain('anchorLayerId')
  })

  it('styleOverride:空物件不序列化(避免噪音)', () => {
    const t: TranslationJson = {
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ id: 'a', x: 0, y: 0, groupId: null, lines: [], styleOverride: {} }],
    }
    const raw = serializeTranslation(t)
    expect(raw).not.toContain('styleOverride')
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
