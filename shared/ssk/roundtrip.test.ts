import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSskProject, serializeSskProject } from './schema'

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
}

describe('ssk round-trip', () => {
  // basic/emoji fixture 以 canonical 形式(固定 key 序、縮排 2、結尾換行)書寫,
  // 逐字元一致同時釘住序列化格式不漂移
  it.each(['basic.ssk.json', 'emoji.ssk.json'])('%s 逐字元一致', (name) => {
    const raw = fixture(name)
    expect(serializeSskProject(parseSskProject(raw))).toBe(raw)
  })

  it('minimal(缺欄位)→ canonical 化後自身達成逐字元 round-trip', () => {
    const canonical = serializeSskProject(parseSskProject(fixture('minimal.ssk.json')))
    expect(serializeSskProject(parseSskProject(canonical))).toBe(canonical)
  })

  it('serialize 冪等:同一物件序列化兩次結果相同', () => {
    const p = parseSskProject(fixture('basic.ssk.json'))
    expect(serializeSskProject(p)).toBe(serializeSskProject(p))
  })

  it('emoji 經 round-trip 後 code point 不損毀', () => {
    const p = parseSskProject(serializeSskProject(parseSskProject(fixture('emoji.ssk.json'))))
    const lines = p.images[0].labels[0].lines
    expect([...lines[0]][0]).toBe('🎵')
    expect(lines[1]).toContain('𠀋')
  })
})
