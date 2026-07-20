import { describe, expect, it } from 'vitest'
import { previewImport } from './import'

describe('previewImport', () => {
  it('空對空:全空 diff', () => {
    expect(previewImport([], [])).toEqual({
      toAdd: [],
      existing: [],
      orphanRaws: [],
    })
  })

  it('root 全新:全部進 toAdd', () => {
    const r = previewImport(['01.png', '02.png', '03.png'], [])
    expect(r.toAdd).toEqual(['01.png', '02.png', '03.png'])
    expect(r.existing).toEqual([])
    expect(r.orphanRaws).toEqual([])
  })

  it('raws 全對齊:全部進 existing', () => {
    const r = previewImport(['01.png', '02.png'], ['01.png', '02.png'])
    expect(r.toAdd).toEqual([])
    expect(r.existing).toEqual(['01.png', '02.png'])
    expect(r.orphanRaws).toEqual([])
  })

  it('root 加了兩張、raws 舊', () => {
    const r = previewImport(
      ['01.png', '02.png', '03.png', '04.png'],
      ['01.png', '02.png'],
    )
    expect(r.toAdd).toEqual(['03.png', '04.png'])
    expect(r.existing).toEqual(['01.png', '02.png'])
    expect(r.orphanRaws).toEqual([])
  })

  it('root 刪了一張、raws 保留 → 產生孤兒', () => {
    const r = previewImport(['01.png'], ['01.png', '02.png'])
    expect(r.toAdd).toEqual([])
    expect(r.existing).toEqual(['01.png'])
    expect(r.orphanRaws).toEqual(['02.png'])
  })

  it('大小寫敏感(檔名逐字元比對)', () => {
    const r = previewImport(['Page1.png'], ['page1.png'])
    expect(r.toAdd).toEqual(['Page1.png'])
    expect(r.orphanRaws).toEqual(['page1.png'])
  })

  it('回傳保留 root 傳入的順序(不重排)', () => {
    const r = previewImport(['b.png', 'a.png', 'c.png'], ['a.png'])
    expect(r.toAdd).toEqual(['b.png', 'c.png'])
    expect(r.existing).toEqual(['a.png'])
  })
})
