import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SskParseError, defaultExportConfig, defaultSskProject, parseSskProject } from './schema'

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
}

/** 以 basic fixture 為底,patch 後重新序列化成待測輸入 */
function patched(patch: (data: Record<string, unknown>) => void): string {
  const data = JSON.parse(fixture('basic.ssk.json'))
  patch(data)
  return JSON.stringify(data)
}

describe('parseSskProject / 合法輸入', () => {
  it('basic fixture 完整解析', () => {
    const p = parseSskProject(fixture('basic.ssk.json'))
    expect(p.version).toBe(1)
    expect(p.groups).toEqual(['框内', '框外', '拟声词'])
    expect(p.images).toHaveLength(2)
    expect(p.images[0].labels[0].lines).toEqual(['第一行譯文', '第二行譯文'])
    expect(p.exportConfig.textDirection).toBe('vertical')
    expect(p.exportConfig.textColor).toBe('#1a2b3c')
    expect(p.exportConfig.exportGroups).toEqual(['框内', '框外'])
  })

  it('BOM 開頭的檔案照常解析', () => {
    const p = parseSskProject('\uFEFF' + fixture('basic.ssk.json'))
    expect(p.groups).toHaveLength(3)
  })

  it('emoji / 代理對字元原樣保留', () => {
    const p = parseSskProject(fixture('emoji.ssk.json'))
    const lines = p.images[0].labels[0].lines
    expect(lines[0]).toBe('🎵啦啦啦🎵')
    expect(lines[1]).toContain('𝌆')
    // 代理對長度語義:🎵 佔 2 個 UTF-16 code unit
    expect('🎵'.length).toBe(2)
    expect(lines[3]).toBe('')
  })

  it('minimal:缺 exportConfig/comment 補預設,缺 id 自動生成', () => {
    const p = parseSskProject(fixture('minimal.ssk.json'))
    expect(p.comment).toBe('')
    expect(p.exportConfig).toEqual(defaultExportConfig())
    const label = p.images[0].labels[0]
    expect(label.id).toBeTruthy()
    expect(label.category).toBe(2)
  })

  it('exportConfig 部分缺欄位 → 逐欄補預設', () => {
    const raw = patched((d) => {
      d.exportConfig = { outputFormat: 'jpg' }
    })
    const p = parseSskProject(raw)
    expect(p.exportConfig.outputFormat).toBe('jpg')
    expect(p.exportConfig.docTemplate).toBe('auto')
    expect(p.exportConfig.ignoreNoLabelImages).toBe(true)
  })

  it('POC 舊欄位 fontSizePt 遷移為 fontSizePx', () => {
    const raw = patched((d) => {
      const config = d.exportConfig as Record<string, unknown>
      delete config.fontSizePx
      config.fontSizePt = 41
    })
    const p = parseSskProject(raw)
    expect(p.exportConfig.fontSizePx).toBe(41)
  })
})

describe('parseSskProject / 非法輸入', () => {
  it('非 JSON → SskParseError', () => {
    expect(() => parseSskProject('>>>>>>[001.png]<<<<<<')).toThrow(SskParseError)
  })

  it('version 過新 → 提示更新軟體', () => {
    const raw = patched((d) => {
      d.version = 2
    })
    expect(() => parseSskProject(raw)).toThrow(/較新版本/)
  })

  it('version 缺失 → 拒絕', () => {
    const raw = patched((d) => {
      delete d.version
    })
    expect(() => parseSskProject(raw)).toThrow(SskParseError)
  })

  it('保留字分組名 → 拒絕', () => {
    for (const name of ['_Label', '_start', '_end']) {
      const raw = patched((d) => {
        ;(d.groups as string[])[0] = name
      })
      expect(() => parseSskProject(raw)).toThrow(/保留字/)
    }
  })

  it('分組名重複 → 拒絕', () => {
    const raw = patched((d) => {
      d.groups = ['框内', '框内']
    })
    expect(() => parseSskProject(raw)).toThrow(/重複/)
  })

  it('category 越界 → 拒絕', () => {
    const raw = patched((d) => {
      // basic 有 3 個分組,4 越界
      ;(d.images as { labels: { category: number }[] }[])[0].labels[0].category = 4
    })
    expect(() => parseSskProject(raw)).toThrow(/category/)
  })

  it('lines 內嵌換行 → 拒絕', () => {
    const raw = patched((d) => {
      ;(d.images as { labels: { lines: string[] }[] }[])[0].labels[0].lines = ['第一行\n第二行']
    })
    expect(() => parseSskProject(raw)).toThrow(/內嵌換行/)
  })

  it('圖片檔名重複 → 拒絕', () => {
    const raw = patched((d) => {
      ;(d.images as { filename: string }[])[1].filename = '001.png'
    })
    expect(() => parseSskProject(raw)).toThrow(/重複的圖片檔名/)
  })

  it('exportGroups 引用不存在的分組 → 拒絕', () => {
    const raw = patched((d) => {
      ;(d.exportConfig as { exportGroups: string[] }).exportGroups = ['不存在的組']
    })
    expect(() => parseSskProject(raw)).toThrow(/exportGroups/)
  })

  it('docTemplateFilename 含路徑分隔符 → 拒絕(可攜性)', () => {
    const raw = patched((d) => {
      ;(d.exportConfig as { docTemplateFilename: string }).docTemplateFilename = 'templates/a.psd'
    })
    expect(() => parseSskProject(raw)).toThrow(/可攜/)
  })

  it('enum 欄位存在但值非法 → 大聲失敗而非靜默補預設', () => {
    const raw = patched((d) => {
      ;(d.exportConfig as { outputFormat: string }).outputFormat = 'webp'
    })
    expect(() => parseSskProject(raw)).toThrow(/outputFormat/)
  })

  it('textColor 必須是 #rrggbb，並正規化為小寫', () => {
    const valid = patched((d) => {
      ;(d.exportConfig as { textColor: string }).textColor = '#AABBCC'
    })
    expect(parseSskProject(valid).exportConfig.textColor).toBe('#aabbcc')

    const invalid = patched((d) => {
      ;(d.exportConfig as { textColor: string }).textColor = 'red'
    })
    expect(() => parseSskProject(invalid)).toThrow(/textColor/)
  })
})

describe('defaultSskProject', () => {
  it('以圖片清單建立空工程', () => {
    const p = defaultSskProject(['001.png', '002.png'])
    expect(p.groups).toEqual(['框内', '框外'])
    expect(p.images.map((i) => i.filename)).toEqual(['001.png', '002.png'])
    expect(p.images.every((i) => i.labels.length === 0)).toBe(true)
  })
})
