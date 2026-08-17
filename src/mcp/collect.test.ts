import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type {
  LayerEntry,
  ManifestJson,
  OcrCandidatePersisted,
  OcrJson,
  TextLayerEntry,
} from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { ProjectFile } from '@/types/project'
import { collectTexts } from './collect'
import { renderTexts } from '@shared/mcp/render'

function text(id: string, extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    tags: [],
    rotation: 0,
    lines: [],
    source: { hash: null, by: 'auto' },
    ownSource: '',
    translations: [],
    translation: null,
    style: { ...DEFAULT_TEXT_STYLE },
    ...extra,
  }
}

function reading(hash: string, textValue: string): OcrCandidatePersisted {
  return {
    hash,
    source: 'manga-ocr',
    text: textValue,
    original: textValue,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    confidence: 0.9,
    label: 'text_bubble',
  }
}

function file(
  pageId: string,
  layers: LayerEntry[],
  readingOrder: string[],
  candidates: OcrCandidatePersisted[] = [],
  badge: ProjectFile['badge'] = 'ok',
): ProjectFile {
  const page: ManifestJson = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: pageId,
    width: 1200,
    height: 1700,
    readingOrder,
    readingEdges: [],
    layers,
  }
  const ocr: OcrJson = { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates }
  return { pageId, page, ocr, pageDir: `/p/${pageId}`, badge }
}

describe('collectTexts', () => {
  it('resolves the source through the reading pool and the translation through the slot', () => {
    const entry = text('a', {
      source: { hash: 'h1', by: 'auto' },
      lines: ['typed'],
      translations: [{ id: 't1', lines: ['from slot'] }],
      translation: 't1',
    })
    const pages = collectTexts([file('001', [entry], ['a'], [reading('h1', '何言ってんの')])])
    expect(pages).toEqual([
      {
        pageId: '001',
        badge: 'ok',
        objects: [{ id: 'a', source: '何言ってんの', translation: 'from slot' }],
      },
    ])
  })

  it('answers own written source, and falls back to typed lines with no slot', () => {
    const entry = text('a', {
      source: { hash: 'own', by: 'human' },
      ownSource: 'ザワザワ',
      lines: ['沙沙'],
    })
    const [page] = collectTexts([file('001', [entry], ['a'])])
    expect(page.objects).toEqual([{ id: 'a', source: 'ザワザワ', translation: '沙沙' }])
  })

  it('reports nothing rather than something for an empty slot and a dangling hash', () => {
    const entry = text('a', { source: { hash: 'gone', by: 'auto' } })
    const [page] = collectTexts([file('001', [entry], ['a'])])
    expect(page.objects).toEqual([{ id: 'a', source: null, translation: '' }])
  })

  it('walks pages in reading order and keeps damaged pages listed but empty', () => {
    const ok = file('001', [text('b'), text('a')], ['b', 'a'])
    const damaged = file('002', [text('c')], ['c'], [], 'damaged')
    const pages = collectTexts([ok, damaged])
    expect(pages[0].objects.map((o) => o.id)).toEqual(['b', 'a'])
    expect(pages[1]).toEqual({ pageId: '002', badge: 'damaged', objects: [] })
  })
})

describe('renderTexts', () => {
  it('renders a script a model can read, marking the empty answers', () => {
    const rendered = renderTexts([
      {
        pageId: '001',
        badge: 'ok',
        objects: [
          { id: 'a', source: '何言ってんの', translation: '你在說什麼啊' },
          { id: 'b', source: null, translation: '' },
        ],
      },
      { pageId: '002', badge: 'damaged', objects: [] },
    ])
    expect(rendered).toContain('2 頁 · 2 個文字物件')
    expect(rendered).toContain('原文: 何言ってんの')
    expect(rendered).toContain('譯文: 你在說什麼啊')
    expect(rendered).toContain('原文: （無）')
    expect(rendered).toContain('譯文: （未翻）')
    expect(rendered).toContain('頁 002 ·（damaged，內容不可讀）')
  })
})
