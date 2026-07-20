import { describe, expect, it } from 'vitest'
import type { StyleGroup } from '@shared/project/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { parseLabelDrag, resolveDropGroupId, serializeLabelDrag } from './labelDrag'

const raw = () => serializeLabelDrag({
  source: 'text-board',
  operation: 'copy',
  token: 'drag-1',
  sourceId: 'label-1',
  label: { text: '文字', groupId: 'grp-side', groupName: '旁白' },
  grabOffset: { x: 8, y: 12 },
})

function makeGroup(id: string, name: string): StyleGroup {
  return { id, name, color: '#000000', style: { ...DEFAULT_TEXT_STYLE } }
}

describe('label drag protocol', () => {
  it('序列化並驗證跨視窗文字物件', () => {
    expect(parseLabelDrag(raw())).toEqual({
      version: 2,
      kind: 'label',
      source: 'text-board',
      operation: 'copy',
      token: 'drag-1',
      sourceId: 'label-1',
      label: { text: '文字', groupId: 'grp-side', groupName: '旁白' },
      grabOffset: { x: 8, y: 12 },
    })
  })

  it('拒絕損壞或未知操作', () => {
    expect(parseLabelDrag('{')).toBeNull()
    expect(parseLabelDrag(raw().replace('"copy"', '"link"'))).toBeNull()
  })

  it('落下時精準 id 匹配優先於 name', () => {
    const payload = parseLabelDrag(raw())!
    // 同 id 存在 → 用 id
    expect(
      resolveDropGroupId(
        payload,
        [makeGroup('grp-inner', '框內'), makeGroup('grp-side', '別的名字')],
        null,
      ),
    ).toBe('grp-side')
  })

  it('id 不存在時 fallback 到 name 匹配', () => {
    const payload = parseLabelDrag(raw())!
    expect(
      resolveDropGroupId(
        payload,
        [makeGroup('grp-a', '框內'), makeGroup('grp-b', '旁白')],
        null,
      ),
    ).toBe('grp-b')
  })

  it('id 與 name 皆無匹配則回 fallback', () => {
    const payload = parseLabelDrag(raw())!
    expect(
      resolveDropGroupId(payload, [makeGroup('grp-a', '框內')], 'grp-fallback'),
    ).toBe('grp-fallback')
  })
})
