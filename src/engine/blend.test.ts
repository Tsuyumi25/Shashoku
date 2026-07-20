import { describe, expect, it } from 'vitest'
import { BLEND_MODES } from './blend'
import { BLEND_MODE_ALLOWLIST } from '@shared/page/schema'

describe('BLEND_MODE_ALLOWLIST 對齊', () => {
  it('shared/page/schema.ts 的 allowlist 等於引擎 BLEND_MODES(避免格式與運算 drift)', () => {
    expect([...BLEND_MODE_ALLOWLIST]).toEqual([...BLEND_MODES])
  })
})
