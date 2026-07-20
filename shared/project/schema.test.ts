import { describe, expect, it } from 'vitest'
import {
  defaultProjectJson,
  parseProjectJson,
  ProjectParseError,
  serializeProjectJson,
} from './schema'
import { PROJECT_SCHEMA_VERSION } from './types'

describe('defaultProjectJson', () => {
  it('回傳合法的最小專案 metadata', () => {
    const p = defaultProjectJson()
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(p.groups).toEqual(['框内', '框外'])
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
      groups: ['大聲', '小聲', '心聲'],
      comment: '第 1 話',
      glossary: { '零式': '型號', 'コロネ': '螺絲卷麵包' },
    }
    const back = parseProjectJson(serializeProjectJson(p))
    expect(back).toEqual(p)
  })

  it('序列化輸出結尾有換行(git diff 友善)', () => {
    const json = serializeProjectJson(defaultProjectJson())
    expect(json.endsWith('\n')).toBe(true)
  })

  it('序列化 key 順序穩定 (schemaVersion 在前)', () => {
    const json = serializeProjectJson(defaultProjectJson())
    expect(json.indexOf('"schemaVersion"')).toBeLessThan(json.indexOf('"groups"'))
    expect(json.indexOf('"groups"')).toBeLessThan(json.indexOf('"comment"'))
  })
})

describe('parseProjectJson 錯誤情境', () => {
  it('非 JSON 抛 ProjectParseError', () => {
    expect(() => parseProjectJson('this is not json')).toThrow(ProjectParseError)
  })

  it('頂層非物件抛錯', () => {
    expect(() => parseProjectJson('[]')).toThrow(/頂層必須是物件/)
  })

  it('schemaVersion 錯誤抛錯', () => {
    expect(() => parseProjectJson('{"schemaVersion":0}')).toThrow(/不支援的 project\.json 版本/)
  })

  it('schemaVersion 較新抛出「請更新軟體」', () => {
    expect(() => parseProjectJson('{"schemaVersion":999}')).toThrow(/請更新軟體/)
  })

  it('groups 空陣列抛錯', () => {
    const bad = JSON.stringify({ schemaVersion: 1, groups: [] })
    expect(() => parseProjectJson(bad)).toThrow(/至少一個分組名/)
  })

  it('groups 含保留字抛錯', () => {
    const bad = JSON.stringify({ schemaVersion: 1, groups: ['_Label'] })
    expect(() => parseProjectJson(bad)).toThrow(/保留字/)
  })

  it('glossary 非物件抛錯', () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      groups: ['a'],
      glossary: ['not-an-object'],
    })
    expect(() => parseProjectJson(bad)).toThrow(/glossary 必須是物件/)
  })

  it('BOM 開頭仍能解析', () => {
    const json = '﻿' + serializeProjectJson(defaultProjectJson())
    expect(() => parseProjectJson(json)).not.toThrow()
  })
})
