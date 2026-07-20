import { describe, expect, it } from 'vitest'
import {
  defaultColorForGroupIndex,
  defaultProjectJson,
  parseProjectJson,
  ProjectParseError,
  serializeProjectJson,
} from './schema'
import type { StyleGroup } from './types'
import { PROJECT_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'

/** helper:v2 fixture 需要合法的 StyleGroup 物件 */
function styleGroup(id: string, name: string, i = 0): StyleGroup {
  return {
    id,
    name,
    color: defaultColorForGroupIndex(i),
    style: { ...DEFAULT_TEXT_STYLE },
  }
}

describe('defaultProjectJson', () => {
  it('回傳合法的最小專案 metadata(v2:StyleGroup + defaultStyle)', () => {
    const p = defaultProjectJson()
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(p.groups.map((g) => g.name)).toEqual(['框内', '框外'])
    // 每個預設 group 帶 id / color / style
    for (const g of p.groups) {
      expect(g.id).toBeTruthy()
      expect(g.color).toBeTruthy()
      expect(g.style).toEqual(DEFAULT_TEXT_STYLE)
    }
    expect(p.defaultStyle).toEqual(DEFAULT_TEXT_STYLE)
    expect(p.comment).toBe('')
    expect(p.glossary).toBeUndefined()
    expect(p.exportConfig.docTemplate).toBe('auto')
  })
})

describe('serialize/parse roundtrip', () => {
  it('預設值 roundtrip 相等', () => {
    const p = defaultProjectJson()
    const json = serializeProjectJson(p)
    const back = parseProjectJson(json)
    expect(back).toEqual(p)
  })

  it('含 glossary 的 roundtrip', () => {
    const p: ReturnType<typeof defaultProjectJson> = {
      ...defaultProjectJson(),
      groups: [
        styleGroup('grp-1', '大聲', 0),
        styleGroup('grp-2', '小聲', 1),
        styleGroup('grp-3', '心聲', 2),
      ],
      comment: '第 1 話',
      glossary: { 零式: '型號', コロネ: '螺絲卷麵包' },
    }
    const back = parseProjectJson(serializeProjectJson(p))
    expect(back).toEqual(p)
  })

  it('序列化輸出結尾有換行(git diff 友善)', () => {
    const json = serializeProjectJson(defaultProjectJson())
    expect(json.endsWith('\n')).toBe(true)
  })

  it('序列化 key 順序穩定 (schemaVersion 在前,defaultStyle 緊跟 groups)', () => {
    const json = serializeProjectJson(defaultProjectJson())
    expect(json.indexOf('"schemaVersion"')).toBeLessThan(json.indexOf('"groups"'))
    expect(json.indexOf('"groups"')).toBeLessThan(json.indexOf('"defaultStyle"'))
    expect(json.indexOf('"defaultStyle"')).toBeLessThan(json.indexOf('"comment"'))
  })
})

describe('parseProjectJson 錯誤情境', () => {
  it('非 JSON 抛 ProjectParseError', () => {
    expect(() => parseProjectJson('this is not json')).toThrow(ProjectParseError)
  })

  it('頂層非物件抛錯', () => {
    expect(() => parseProjectJson('[]')).toThrow(/頂層必須是物件/)
  })

  it('schemaVersion 錯誤(舊 v1)抛錯明示需重建', () => {
    expect(() => parseProjectJson('{"schemaVersion":1}')).toThrow(/v2 以下的舊格式/)
  })

  it('schemaVersion 較新抛出「請更新軟體」', () => {
    expect(() => parseProjectJson('{"schemaVersion":999}')).toThrow(/請更新軟體/)
  })

  it('groups 空陣列抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      groups: [],
      defaultStyle: DEFAULT_TEXT_STYLE,
    })
    expect(() => parseProjectJson(bad)).toThrow(/至少一個 StyleGroup/)
  })

  it('groups 含保留字抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      groups: [
        { id: 'x', name: '_Label', color: '#000000', style: DEFAULT_TEXT_STYLE },
      ],
      defaultStyle: DEFAULT_TEXT_STYLE,
    })
    expect(() => parseProjectJson(bad)).toThrow(/保留字/)
  })

  it('groups 重複 name 抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      groups: [
        { id: 'x', name: '對白', color: '#000000', style: DEFAULT_TEXT_STYLE },
        { id: 'y', name: '對白', color: '#111111', style: DEFAULT_TEXT_STYLE },
      ],
      defaultStyle: DEFAULT_TEXT_STYLE,
    })
    expect(() => parseProjectJson(bad)).toThrow(/name 不可重複/)
  })

  it('defaultStyle 缺欄位抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      groups: [{ id: 'x', name: '對白', color: '#000000', style: DEFAULT_TEXT_STYLE }],
      defaultStyle: { fontFamily: 'x' },
    })
    expect(() => parseProjectJson(bad)).toThrow(/defaultStyle\./)
  })

  it('glossary 非物件抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      groups: [{ id: 'x', name: 'a', color: '#000000', style: DEFAULT_TEXT_STYLE }],
      defaultStyle: DEFAULT_TEXT_STYLE,
      glossary: ['not-an-object'],
    })
    expect(() => parseProjectJson(bad)).toThrow(/glossary 必須是物件/)
  })

  it('BOM 開頭仍能解析', () => {
    const json = '﻿' + serializeProjectJson(defaultProjectJson())
    expect(() => parseProjectJson(json)).not.toThrow()
  })
})
