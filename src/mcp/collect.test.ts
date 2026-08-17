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
import { planProposal } from './propose'
import { renderProposeOutcomes, renderTexts } from '@shared/mcp/render'

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
        objects: [
          {
            id: 'a',
            source: '何言ってんの',
            translation: 'from slot',
            candidates: [{ id: 't1', text: 'from slot', human: false, chosen: true }],
          },
        ],
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
    expect(page.objects).toEqual([
      { id: 'a', source: 'ザワザワ', translation: '沙沙', candidates: [] },
    ])
  })

  it('reports nothing rather than something for an empty slot and a dangling hash', () => {
    const entry = text('a', { source: { hash: 'gone', by: 'auto' } })
    const [page] = collectTexts([file('001', [entry], ['a'])])
    expect(page.objects).toEqual([{ id: 'a', source: null, translation: '', candidates: [] }])
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
          {
            id: 'a',
            source: '何言ってんの',
            translation: '你在說什麼啊',
            candidates: [
              { id: 't1', text: '你在說什麼啊', human: false, chosen: true },
              { id: 't2', text: '少騙人了', human: true, chosen: false },
              {
                id: 't3',
                text: '才不是那樣呢',
                human: false,
                chosen: false,
                source: 'claude-code 2.1.219',
              },
            ],
          },
          { id: 'b', source: null, translation: '', candidates: [] },
        ],
      },
      { pageId: '002', badge: 'damaged', objects: [] },
    ])
    expect(rendered).toContain('2 頁 · 2 個文字物件')
    expect(rendered).toContain('原文: 何言ってんの')
    expect(rendered).toContain('譯文: 你在說什麼啊')
    expect(rendered).toContain(
      '候選: ✓t1「你在說什麼啊」 ／ t2「少騙人了」（human） ／ t3「才不是那樣呢」（claude-code 2.1.219）',
    )
    expect(rendered).toContain('原文: （無）')
    expect(rendered).toContain('譯文: （未翻）')
    expect(rendered).toContain('頁 002 ·（damaged，內容不可讀）')
  })
})

describe('planProposal', () => {
  const base = () => text('a')

  it('appends and fills where the object reads as nothing at all', () => {
    expect(planProposal(base(), ['新譯'])).toEqual({ action: 'append', fillSlot: true })
  })

  it('appends without touching typed lines nobody chose', () => {
    expect(planProposal(text('a', { lines: ['人打的'] }), ['新譯'])).toEqual({
      action: 'append',
      fillSlot: false,
    })
  })

  it('appends without touching a settled slot', () => {
    const entry = text('a', {
      translations: [{ id: 't1', lines: ['已選'] }],
      translation: 't1',
    })
    expect(planProposal(entry, ['新譯'])).toEqual({ action: 'append', fillSlot: false })
  })

  it('refuses what it cannot store, saying why', () => {
    expect(planProposal(undefined, ['x'])).toEqual({ action: 'refuse', reason: '物件不存在' })
    expect(planProposal(base(), []).action).toBe('refuse')
    expect(planProposal(base(), ['有\n換行']).action).toBe('refuse')
    expect(planProposal(base(), ['', ' ']).action).toBe('refuse')
  })
})

describe('renderProposeOutcomes', () => {
  it('says what landed, what took effect, and what was refused', () => {
    const rendered = renderProposeOutcomes([
      { objectId: 'a', ok: true, translationId: 't1', filledSlot: true },
      { objectId: 'b', ok: true, translationId: 't2', filledSlot: false },
      { objectId: 'c', ok: false, reason: '物件不存在' },
    ])
    expect(rendered).toContain('收下 2 則，拒絕 1 則')
    expect(rendered).toContain('a → 候選 t1（物件原本空白，已直接生效）')
    expect(rendered).toContain('b → 候選 t2（進入抽屜，現值未動）')
    expect(rendered).toContain('c ✗ 物件不存在')
  })
})
