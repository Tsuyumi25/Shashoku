import { describe, expect, it } from 'vitest'
import { parseLabelDrag, resolveDropCategory, serializeLabelDrag } from './labelDrag'

const raw = () => serializeLabelDrag({
  source: 'text-board',
  operation: 'copy',
  token: 'drag-1',
  sourceId: 'label-1',
  label: { text: '文字', category: 2, groupName: '旁白' },
  grabOffset: { x: 8, y: 12 },
})

describe('label drag protocol', () => {
  it('序列化並驗證跨視窗文字物件', () => {
    expect(parseLabelDrag(raw())).toEqual({
      version: 1,
      kind: 'label',
      source: 'text-board',
      operation: 'copy',
      token: 'drag-1',
      sourceId: 'label-1',
      label: { text: '文字', category: 2, groupName: '旁白' },
      grabOffset: { x: 8, y: 12 },
    })
  })

  it('拒絕損壞或未知操作', () => {
    expect(parseLabelDrag('{')).toBeNull()
    expect(parseLabelDrag(raw().replace('"copy"', '"link"'))).toBeNull()
  })

  it('落下時優先對齊同名分組', () => {
    const payload = parseLabelDrag(raw())!
    expect(resolveDropCategory(payload, ['框內', '框外', '旁白'], 1)).toBe(3)
    expect(resolveDropCategory(payload, ['框內', '框外'], 1)).toBe(2)
    expect(resolveDropCategory(payload, ['框內'], 1)).toBe(1)
  })
})
