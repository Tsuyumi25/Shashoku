import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type {
  LayerEntry,
  ManifestJson,
  OcrCandidatePersisted,
  OcrJson,
  TextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { ProjectFile } from '@/types/project'
import { collectTexts } from './collect'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'
import { renderProposeResult, renderTexts, renderWithdrawResult } from '@shared/mcp/render'
import { blankBlock } from '@shared/page/schema'

/** One ordinary translation: one block a side, and the unit that holds them. */
function said(
  id: string,
  over: { words?: string[]; artwork?: string[] } & Partial<TranslationUnit> = {},
): { unit: TranslationUnit; blocks: TextLayerEntry[] } {
  const { words, artwork, ...rest } = over
  const lettering = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  lettering.body.lines = words ?? []
  const read = blankBlock(`${id}s`, 'source', DEFAULT_TEXT_STYLE)
  read.body.lines = artwork ?? []
  return {
    unit: {
      id: `u-${id}`,
      tags: [],
      source: { members: [read.id], separators: [] },
      translation: { members: [lettering.id], separators: [] },
      candidates: [],
      chosen: null,
      ...rest,
    },
    blocks: [lettering, read],
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
  said: { unit: TranslationUnit; blocks: TextLayerEntry[] }[],
  readingOrder: string[],
  candidates: OcrCandidatePersisted[] = [],
  badge: ProjectFile['badge'] = 'ok',
): ProjectFile {
  const layers: LayerEntry[] = said.flatMap((s) => s.blocks)
  const page: ManifestJson = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: pageId,
    width: 1200,
    height: 1700,
    translationUnits: said.map((s) => s.unit),
    readingOrder,
    readingEdges: [],
    layers,
  }
  const ocr: OcrJson = { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates }
  return { pageId, page, ocr, pageDir: `/p/${pageId}`, badge }
}

describe('collectTexts', () => {
  it('answers the artwork own words, and the translation through the slot', () => {
    const a = said('a', {
      words: ['typed'],
      artwork: ['何言ってんの'],
      candidates: [{ id: 't1', pieces: [['from slot']] }],
      chosen: 't1',
    })
    const pages = collectTexts([file('001', [a], ['u-a'], [reading('h1', '何言ってんの')])])
    expect(pages).toEqual([
      {
        pageId: '001',
        badge: 'ok',
        objects: [
          {
            id: 'u-a',
            source: '何言ってんの',
            translation: 'from slot',
            blocks: 1,
            candidates: [{ id: 't1', text: 'from slot', human: false, chosen: true }],
          },
        ],
      },
    ])
  })

  it('falls back to typed words with no slot filled', () => {
    const a = said('a', { artwork: ['ザワザワ'], words: ['沙沙'] })
    const [page] = collectTexts([file('001', [a], ['u-a'])])
    expect(page.objects).toEqual([
      { id: 'u-a', source: 'ザワザワ', translation: '沙沙', blocks: 1, candidates: [] },
    ])
  })

  /**
   * A birth certificate naming a reading the pool has lost decides nothing:
   * the words are the block's own, and here it has none.
   */
  it('reports nothing rather than something for a translation that says nothing', () => {
    const a = said('a')
    const [page] = collectTexts([file('001', [a], ['u-a'])])
    expect(page.objects).toEqual([
      { id: 'u-a', source: null, translation: '', blocks: 1, candidates: [] },
    ])
  })

  /** ⭐ What the escape hatch is for: the model has to know it needs two pieces. */
  it('says how many blocks the lettering was split into', () => {
    const a = said('a', { artwork: ['くぱぁ'] })
    const second = blankBlock('a2', 'translation', DEFAULT_TEXT_STYLE)
    second.body.lines = ['開']
    a.blocks[0].body.lines = ['掰']
    a.blocks.push(second)
    a.unit.translation = { members: ['a', 'a2'], separators: [''] }
    const [page] = collectTexts([file('001', [a], ['u-a'])])
    expect(page.objects[0]).toMatchObject({ translation: '掰開', blocks: 2 })
  })

  it('walks pages in reading order and keeps damaged pages listed but empty', () => {
    const ok = file('001', [said('b'), said('a')], ['u-b', 'u-a'])
    const damaged = file('002', [said('c')], ['u-c'], [], 'damaged')
    const pages = collectTexts([ok, damaged])
    expect(pages[0].objects.map((o) => o.id)).toEqual(['u-b', 'u-a'])
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
            blocks: 1,
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
          { id: 'b', source: null, translation: '', blocks: 1, candidates: [] },
        ],
      },
      { pageId: '002', badge: 'damaged', objects: [] },
    ])
    expect(rendered).toContain('2 頁 · 2 筆翻譯')
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
  const plan = (a: ReturnType<typeof said>, lines: string[]) =>
    planProposal(file('001', [a], ['u-a']).page, a.unit, { unitId: a.unit.id, lines })

  it('appends and fills where the translation reads as nothing at all', () => {
    expect(plan(said('a'), ['新譯'])).toEqual({
      action: 'append',
      pieces: [['新譯']],
      fillSlot: true,
    })
  })

  it('appends without touching words nobody chose', () => {
    expect(plan(said('a', { words: ['人打的'] }), ['新譯'])).toMatchObject({
      action: 'append',
      fillSlot: false,
    })
  })

  it('appends without touching a settled slot', () => {
    const a = said('a', { candidates: [{ id: 't1', pieces: [['已選']] }], chosen: 't1' })
    expect(plan(a, ['新譯'])).toMatchObject({ action: 'append', fillSlot: false })
  })

  /** ⚠️ A proposal the blocks cannot read from must not become what shows. */
  it('appends without filling where the block count disagrees', () => {
    const a = said('a')
    const second = blankBlock('a2', 'translation', DEFAULT_TEXT_STYLE)
    a.blocks.push(second)
    a.unit.translation = { members: ['a', 'a2'], separators: [''] }
    expect(plan(a, ['新譯'])).toMatchObject({ action: 'append', fillSlot: false })
  })

  it('refuses what it cannot store, saying why', () => {
    const a = said('a')
    const page = file('001', [a], ['u-a']).page
    expect(planProposal(page, undefined, { unitId: 'x', lines: ['x'] })).toEqual({
      action: 'refuse',
      reason: '這一筆翻譯不存在',
    })
    expect(plan(a, []).action).toBe('refuse')
    expect(plan(a, ['有\n換行']).action).toBe('refuse')
    expect(plan(a, ['', ' ']).action).toBe('refuse')
    expect(
      planProposal(page, a.unit, { unitId: a.unit.id, lines: ['x'], pieces: [['x']] }).action,
    ).toBe('refuse')
  })
})

describe('planWithdraw', () => {
  const CLIENT = 'claude-code 2.1.219'
  const drawer = (extra: Partial<TranslationUnit> = {}) =>
    said('a', {
      candidates: [
        { id: 'mine', pieces: [['本 client 提的']], source: CLIENT },
        { id: 'theirs', pieces: [['別的 client 提的']], source: 'codex 1.0' },
        { id: 'yours', pieces: [['人寫的']], human: true },
        { id: 'old', pieces: [['署名機制前的']] },
      ],
      ...extra,
    }).unit

  it('removes a candidate stamped with the same client', () => {
    expect(planWithdraw(drawer(), 'mine', CLIENT)).toEqual({ action: 'remove', wasChosen: false })
  })

  it('removes even the chosen one, saying the slot will clear', () => {
    expect(planWithdraw(drawer({ chosen: 'mine' }), 'mine', CLIENT)).toEqual({
      action: 'remove',
      wasChosen: true,
    })
  })

  it("refuses everything that is not its own stamp", () => {
    expect(planWithdraw(undefined, 'mine', CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), 'gone', CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), 'yours', CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), 'theirs', CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), 'old', CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), 'mine', undefined).action).toBe('refuse')
  })
})

describe('renderProposeResult', () => {
  it('says what landed, what took effect, what was refused, then the state', () => {
    const rendered = renderProposeResult({
      outcomes: [
        { unitId: 'a', ok: true, translationId: 't1', filledSlot: true },
        { unitId: 'b', ok: true, translationId: 't2', filledSlot: false },
        { unitId: 'c', ok: false, reason: '物件不存在' },
      ],
      objects: [
        {
          id: 'a',
          source: null,
          translation: '新譯',
          blocks: 1,
          candidates: [{ id: 't1', text: '新譯', human: false, chosen: true }],
        },
      ],
    })
    expect(rendered).toContain('收下 2 則，拒絕 1 則')
    expect(rendered).toContain('a → 候選 t1（這一筆原本空白，已直接生效）')
    expect(rendered).toContain('b → 候選 t2（進入抽屜，現值未動）')
    expect(rendered).toContain('c ✗ 物件不存在')
    expect(rendered).toContain('操作後的物件狀態：')
    expect(rendered).toContain('✓t1「新譯」')
  })
})

describe('renderWithdrawResult', () => {
  it('reports per item and shows whether a slot cleared', () => {
    const rendered = renderWithdrawResult({
      outcomes: [
        { unitId: 'a', translationId: 't1', ok: true, clearedSlot: true },
        { unitId: 'a', translationId: 't2', ok: false, reason: '這是人寫過的候選——不可撤' },
      ],
      objects: [],
    })
    expect(rendered).toContain('候選 t1 已撤回（原為現值，物件已回退為自己的字）')
    expect(rendered).toContain('候選 t2 ✗ 這是人寫過的候選——不可撤')
  })
})
