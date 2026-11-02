import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type {
  ManifestJson,
  SourceTextLayerEntry,
  TextLayerEntry,
  TranslationBody,
  TranslationCandidate,
  TranslationTextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import type { TranslationFace } from '@shared/project/types'
import { blankSourceBlock, blankTranslationBlock, defaultManifest, defaultOcr } from '@shared/page/schema'
import type { ProjectFile } from '@/types/project'
import type { FaceTexts, PageTexts, SentenceTexts } from '@shared/mcp/types'
import { collectTexts, resolveObject } from './collect'
import { planWithdraw } from './withdraw'
import {
  noteSeen,
  renderProposeResult,
  renderTexts,
  renderWithdrawResult,
  sinceSeen,
  type SeenTexts,
} from '@shared/mcp/render'

const ZH = 'zh'
const EN = 'en'
const FACES: TranslationFace[] = [
  { id: ZH, name: '譯文' },
  { id: EN, name: 'English' },
]
const ZH_ONLY = FACES.slice(0, 1)

function src(id: string, lines: string[]): SourceTextLayerEntry {
  const block = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
  block.body.lines = lines
  return block
}

function tr(
  id: string,
  face: string,
  lines: string[],
  over: Partial<TranslationBody> = {},
): TranslationTextLayerEntry {
  const block = blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
  block.body = { ...block.body, lines, ...over }
  return block
}

/** A page from its blocks and, per face, the sentences it is read as, in that order. */
function pageOf(blocks: TextLayerEntry[], ledgers: Record<string, TranslationUnit[]>): ManifestJson {
  const page = defaultManifest('p', 1200, 1700)
  page.layers = blocks
  for (const [face, units] of Object.entries(ledgers)) {
    page.ledgers[face] = { units, readingOrder: units.map((u) => u.id), readingEdges: [] }
  }
  return page
}

function file(pageId: string, page: ManifestJson, badge: ProjectFile['badge'] = 'ok'): ProjectFile {
  return { pageId, page, ocr: defaultOcr(1200, 1700), pageDir: `/p/${pageId}`, badge }
}

/** One ordinary balloon in one face: a block of artwork and a block of lettering. */
function balloon(
  id: string,
  artwork: string[],
  words: string[],
  body: Partial<TranslationBody> = {},
): { blocks: TextLayerEntry[]; unit: TranslationUnit } {
  const source = src(`${id}s`, artwork)
  const lettering = tr(`${id}t`, ZH, words, body)
  return { blocks: [source, lettering], unit: { id: `u-${id}`, members: [source.id, lettering.id] } }
}

const CHOSEN = (id: string, lines: string[]): Partial<TranslationBody> => ({
  candidates: [{ id, lines }],
  chosen: id,
})

describe('collectTexts', () => {
  it('answers the artwork own words, and the translation through the slot', () => {
    const one = balloon('a', ['何言ってんの'], ['typed'], CHOSEN('t1', ['from slot']))
    const pages = collectTexts([file('001', pageOf(one.blocks, { [ZH]: [one.unit] }))], ZH_ONLY)
    expect(pages).toEqual([
      {
        pageId: '001',
        badge: 'ok',
        faces: [
          {
            faceId: ZH,
            name: '譯文',
            sentences: [
              {
                id: 'u-a',
                source: '何言ってんの',
                translation: 'from slot',
                candidates: [{ id: 't1', text: 'from slot', human: false, chosen: true }],
              },
            ],
          },
        ],
      },
    ])
  })

  it('falls back to typed words with no slot filled', () => {
    const one = balloon('a', ['ザワザワ'], ['沙沙'])
    const [page] = collectTexts([file('001', pageOf(one.blocks, { [ZH]: [one.unit] }))], ZH_ONLY)
    expect(page.faces[0].sentences).toEqual([
      { id: 'u-a', source: 'ザワザワ', translation: '沙沙', candidates: [] },
    ])
  })

  it('reports nothing rather than something for a sentence that says nothing', () => {
    const one = balloon('a', [], [])
    const [page] = collectTexts([file('001', pageOf(one.blocks, { [ZH]: [one.unit] }))], ZH_ONLY)
    expect(page.faces[0].sentences).toEqual([
      { id: 'u-a', source: null, translation: '', candidates: [] },
    ])
  })

  /** ⭐ A split sentence is written to by block, so every block has to be named. */
  it('lists each block of a sentence set in several, with its own drawer', () => {
    const source = src('s', ['ゴゴゴ'])
    const first = tr('t1', ZH, ['轟'], CHOSEN('c1', ['轟隆']))
    const second = tr('t2', ZH, ['隆'])
    const unit: TranslationUnit = { id: 'u-a', members: [source.id, first.id, second.id] }
    const [page] = collectTexts([file('001', pageOf([source, first, second], { [ZH]: [unit] }))], ZH_ONLY)
    expect(page.faces[0].sentences[0]).toEqual({
      id: 'u-a',
      source: 'ゴゴゴ',
      translation: '轟隆/隆',
      blocks: [
        { id: 't1', text: '轟隆', candidates: [{ id: 'c1', text: '轟隆', human: false, chosen: true }] },
        { id: 't2', text: '隆', candidates: [] },
      ],
      candidates: [],
    })
  })

  /** ⭐ Every face is listed, named as the person named it: the id is for writing, the name for reading. */
  it('lists every face, each with its own sentences', () => {
    const source = src('s', ['何言ってんの'])
    const zh = tr('z', ZH, ['你在說什麼啊'])
    const en = tr('e', EN, ['What are you saying'])
    const page = pageOf([source, zh, en], {
      [ZH]: [{ id: 'u-zh', members: [source.id, zh.id] }],
      [EN]: [{ id: 'u-en', members: [source.id, en.id] }],
    })
    const [collected] = collectTexts([file('001', page)], FACES)
    expect(collected.faces.map((f) => [f.faceId, f.name])).toEqual([
      [ZH, '譯文'],
      [EN, 'English'],
    ])
    expect(collected.faces[1].sentences).toEqual([
      { id: 'u-en', source: '何言ってんの', translation: 'What are you saying', candidates: [] },
    ])
  })

  it('walks sentences in reading order and keeps damaged pages listed but empty', () => {
    const a = balloon('a', [], [])
    const b = balloon('b', [], [])
    const page = pageOf([...a.blocks, ...b.blocks], { [ZH]: [b.unit, a.unit] })
    const damaged = file('002', pageOf([], {}), 'damaged')
    const pages = collectTexts([file('001', page), damaged], ZH_ONLY)
    expect(pages[0].faces[0].sentences.map((s) => s.id)).toEqual(['u-b', 'u-a'])
    expect(pages[1]).toEqual({ pageId: '002', badge: 'damaged', faces: [] })
  })

  it("reads only the pages asked for, in the project's order whatever order they were asked in", () => {
    const files = ['001', '002', '003'].map((id) => file(id, pageOf([], { [ZH]: [] })))
    expect(collectTexts(files, ZH_ONLY, ['003', '001', 'nope']).map((p) => p.pageId)).toEqual(['001', '003'])
  })
})

describe('resolveObject', () => {
  const source = src('s', ['ゴゴゴ'])
  const split = [tr('t1', ZH, ['轟']), tr('t2', ZH, ['隆'])]
  const one = tr('e', EN, ['Rumble'])
  const page = pageOf([source, ...split, one], {
    [ZH]: [{ id: 'u-zh', members: [source.id, 't1', 't2'] }],
    [EN]: [{ id: 'u-en', members: [source.id, one.id] }],
  })
  const faces = [ZH, EN]

  it('takes a block id and answers with the face that block belongs to', () => {
    const found = resolveObject(page, faces, 't2')
    expect(found).toMatchObject({ place: { face: ZH, block: { id: 't2' } } })
    expect('place' in found && found.place.unit.id).toBe('u-zh')
  })

  /** ⭐ A sentence id is one face's, so the lookup has to reach every ledger. */
  it('takes a sentence id of any face when it is set in one block', () => {
    expect(resolveObject(page, faces, 'u-en')).toMatchObject({
      place: { face: EN, block: { id: 'e' } },
    })
  })

  /** ⚠️ Nothing in the id says which block the words were written for. */
  it('refuses a sentence set in several blocks, saying to name a block', () => {
    const found = resolveObject(page, faces, 'u-zh')
    expect('refusal' in found && found.refusal).toContain('分成 2 塊')
  })

  it('refuses a block of artwork and an id the page does not have', () => {
    expect('refusal' in resolveObject(page, faces, 's')).toBe(true)
    expect(resolveObject(page, faces, 'nowhere')).toEqual({ refusal: '這一筆翻譯不存在' })
  })
})

describe('renderTexts', () => {
  const sentence = (over: Partial<SentenceTexts> = {}): SentenceTexts => ({
    id: 'a',
    source: '何言ってんの',
    translation: '你在說什麼啊',
    candidates: [],
    ...over,
  })

  it('renders a script a model can read, marking the empty answers', () => {
    const rendered = renderTexts(
      [
        {
          pageId: '001',
          badge: 'ok',
          faces: [
            {
              faceId: ZH,
              name: '譯文',
              sentences: [
                sentence({
                  candidates: [
                    { id: 't1', text: '你在說什麼啊', human: false, chosen: true },
                    { id: 't2', text: '少騙人了', human: true, chosen: false },
                    { id: 't3', text: '才不是那樣呢', human: false, chosen: false, source: 'claude-code 2.1.219' },
                  ],
                }),
                sentence({ id: 'b', source: null, translation: '' }),
              ],
            },
            {
              faceId: EN,
              name: 'English',
              sentences: [sentence({ id: 'c', translation: 'What are you saying' })],
            },
          ],
        },
        { pageId: '002', badge: 'damaged', faces: [] },
      ],
      { caller: 'claude-code 2.1.219', missing: ['009'] },
    )
    expect(rendered).toContain('2 頁 · 3 句')
    expect(rendered).toContain('頁 001 · 譯文 · 2 句')
    expect(rendered).toContain('頁 001 · English · 1 句')
    expect(rendered).toContain('原文: 何言ってんの')
    expect(rendered).toContain('譯文: 你在說什麼啊')
    expect(rendered).toContain(
      '候選: ✓t1「你在說什麼啊」（AI） ／ t2「少騙人了」（human） ／ t3「才不是那樣呢」（你）',
    )
    expect(rendered).toContain('沒有這些頁：009')
    expect(rendered).toContain('原文: （無）')
    expect(rendered).toContain('譯文: （未翻）')
    expect(rendered).toContain('頁 002 ·（damaged，內容不可讀）')
  })

  /** ⭐ What tells a model it must write to a block rather than to the sentence. */
  it('names every block of a split sentence and keeps its drawer under it', () => {
    const rendered = renderTexts([
      {
        pageId: '001',
        badge: 'ok',
        faces: [
          {
            faceId: ZH,
            name: '譯文',
            sentences: [
              sentence({
                source: 'ゴゴゴ',
                translation: '轟隆/隆',
                blocks: [
                  { id: 't1', text: '轟隆', candidates: [{ id: 'c1', text: '轟隆', human: false, chosen: true }] },
                  { id: 't2', text: '', candidates: [] },
                ],
              }),
            ],
          },
        ],
      },
    ])
    expect(rendered).toContain('這一句的譯文分成 2 塊，讀起來中間是「/」——提案請指定塊 id')
    expect(rendered).toContain('  塊 t1: 轟隆')
    expect(rendered).toContain('    候選: ✓c1「轟隆」（AI）')
    expect(rendered).toContain('  塊 t2: （未翻）')
  })
})

describe('reading only what changed', () => {
  const sentence = (id: string, translation: string): SentenceTexts => ({
    id,
    source: null,
    translation,
    candidates: [],
  })
  const face = (faceId: string, sentences: SentenceTexts[]): FaceTexts => ({
    faceId,
    name: faceId === ZH ? '譯文' : 'English',
    sentences,
  })
  const page = (pageId: string, faces: FaceTexts[]): PageTexts => ({ pageId, badge: 'ok', faces })

  it('answers everything the first time, then only what reads differently and what is gone', () => {
    const seen: SeenTexts = new Map()
    const before = [
      page('001', [face(ZH, [sentence('a', '甲'), sentence('b', '乙'), sentence('c', '丙')])]),
      page('002', [face(ZH, [sentence('d', '丁')])]),
    ]
    expect(sinceSeen(seen, before, undefined).pages).toEqual(before)
    noteSeen(seen, before, undefined, true)

    const after = [
      page('001', [face(ZH, [sentence('a', '甲'), sentence('b', '乙改')])]),
      page('002', [face(ZH, [sentence('d', '丁')])]),
    ]
    const since = sinceSeen(seen, after, undefined)
    expect(since.pages).toEqual([page('001', [face(ZH, [sentence('b', '乙改')])])])
    expect(since.gone).toEqual(new Map([['001', new Map([[ZH, ['c']]])]]))

    noteSeen(seen, after, undefined, true)
    expect(sinceSeen(seen, after, undefined).pages).toEqual([])
  })

  /** ⚠️ Sentence ids are a face's own, so one face's reading cannot answer for another's. */
  it('keeps each face apart', () => {
    const seen: SeenTexts = new Map()
    noteSeen(seen, [page('001', [face(ZH, [sentence('a', '甲')]), face(EN, [sentence('b', 'A')])])], undefined, true)
    const since = sinceSeen(
      seen,
      [page('001', [face(ZH, [sentence('a', '甲')]), face(EN, [sentence('b', 'B')])])],
      undefined,
    )
    expect(since.pages).toEqual([page('001', [face(EN, [sentence('b', 'B')])])])
  })

  it("takes a write's reply as seen without forgetting the rest of the page", () => {
    const seen: SeenTexts = new Map()
    noteSeen(seen, [page('001', [face(ZH, [sentence('a', '甲'), sentence('b', '乙')])])], undefined, true)
    noteSeen(seen, [page('001', [face(ZH, [sentence('a', '甲改')])])], undefined, false)

    const since = sinceSeen(
      seen,
      [page('001', [face(ZH, [sentence('a', '甲改'), sentence('b', '乙')])])],
      undefined,
    )
    expect(since.pages).toEqual([])
    expect(since.gone.size).toBe(0)
  })
})

describe('planWithdraw', () => {
  const CLIENT = 'claude-code 2.1.219'
  const drawer = (chosen: string | null = null) => {
    const candidates: TranslationCandidate[] = [
      { id: 'mine', lines: ['本 client 提的'], source: CLIENT },
      { id: 'theirs', lines: ['別的 client 提的'], source: 'codex 1.0' },
      { id: 'yours', lines: ['人寫的'], human: true },
      { id: 'old', lines: ['署名機制前的'] },
    ]
    return tr('t', ZH, [], { candidates, chosen })
  }

  it('removes a candidate stamped with the same client', () => {
    expect(planWithdraw(drawer(), 'mine', CLIENT)).toEqual({ action: 'remove', wasChosen: false })
  })

  it('removes even the chosen one, saying the slot will clear', () => {
    expect(planWithdraw(drawer('mine'), 'mine', CLIENT)).toEqual({
      action: 'remove',
      wasChosen: true,
    })
  })

  it('refuses everything that is not its own stamp', () => {
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
        { pageId: '001', objectId: 'a', ok: true, translationId: 't1', filledSlot: true },
        { pageId: '001', objectId: 'b', ok: true, translationId: 't2', filledSlot: false },
        { pageId: '002', objectId: 'c', ok: false, reason: '物件不存在' },
      ],
      pages: [
        {
          pageId: '001',
          badge: 'ok',
          faces: [
            {
              faceId: ZH,
              name: '譯文',
              sentences: [
                {
                  id: 'a',
                  source: null,
                  translation: '新譯',
                  candidates: [{ id: 't1', text: '新譯', human: false, chosen: true }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(rendered).toContain('收下 2 則，拒絕 1 則')
    expect(rendered).toContain('001 · a → 候選 t1（已生效）')
    expect(rendered).toContain('001 · b → 候選 t2（進入抽屜，現值未動）')
    expect(rendered).toContain('002 · c ✗ 物件不存在')
    expect(rendered).toContain('操作後的狀態：')
    expect(rendered).toContain('✓t1「新譯」')
  })
})

describe('renderWithdrawResult', () => {
  it('reports per item and shows whether a slot cleared', () => {
    const rendered = renderWithdrawResult({
      outcomes: [
        { pageId: '001', objectId: 'a', translationId: 't1', ok: true, clearedSlot: true },
        { pageId: '001', objectId: 'a', translationId: 't2', ok: false, reason: '這是人寫過的候選——不可撤' },
      ],
      pages: [],
    })
    expect(rendered).toContain('候選 t1 已撤回（原為現值，物件已回退為自己的字）')
    expect(rendered).toContain('候選 t2 ✗ 這是人寫過的候選——不可撤')
  })
})
