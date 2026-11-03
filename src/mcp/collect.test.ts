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
import { numberPage } from '@shared/page/numbers'
import type { ProjectFile } from '@/types/project'
import type { FaceTexts, PageTexts, SentenceTexts } from '@shared/mcp/types'
import { formatRef, parseFaceRef, parseRef } from '@shared/mcp/refs'
import { addressOf, collectTexts, resolveRef } from './collect'
import { planWithdraw } from './withdraw'
import {
  noteRefs,
  noteSeen,
  renderProposeResult,
  renderTexts,
  renderWithdrawResult,
  seenIdsFor,
  sinceSeen,
  type RefMemory,
  type SeenTexts,
} from '@shared/mcp/render'

const ZH = 'zh'
const EN = 'en'
const FACES: TranslationFace[] = [
  { id: ZH, no: 1, name: '譯文' },
  { id: EN, no: 2, name: 'English' },
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

/** A numbered page from its blocks and, per face, the sentences it is read as. */
function pageOf(
  blocks: TextLayerEntry[],
  ledgers: Record<string, TranslationUnit[]>,
  name = '001.jpg',
): ManifestJson {
  const page = defaultManifest(name, 1200, 1700)
  page.layers = blocks
  for (const [face, units] of Object.entries(ledgers)) page.ledgers[face] = { units }
  const sources = new Set(blocks.flatMap((b) => (b.side === 'source' ? [b.id] : [])))
  page.readingOrder =
    Object.values(ledgers)[0]?.flatMap((u) => u.members.filter((id) => sources.has(id))) ?? []
  numberPage(page, Object.keys(ledgers))
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

describe('addresses', () => {
  it('reads every shape of address and writes it back the same', () => {
    expect(parseRef('p7/14')).toEqual({ pageId: 'p7', sentence: 14 })
    expect(parseRef('p7/14.2')).toEqual({ pageId: 'p7', sentence: 14, block: 2 })
    expect(parseRef('p7/14.2b')).toEqual({ pageId: 'p7', sentence: 14, block: 2, candidate: 2 })
    expect(parseRef('p7/14b')).toEqual({ pageId: 'p7', sentence: 14, candidate: 2 })
    expect(parseRef('2019-04-07_r1/3aa')).toEqual({
      pageId: '2019-04-07_r1',
      sentence: 3,
      candidate: 27,
    })
    expect(formatRef({ pageId: 'p7', sentence: 14, block: 2, candidate: 27 })).toBe('p7/14.2aa')
  })

  it('refuses what is not an address', () => {
    for (const bad of ['p7', 'p7/0', 'p7/14.0', 'p7/14B', 'a/b/3', 'p7/14 b', '']) {
      expect(parseRef(bad)).toBeNull()
    }
    expect(parseFaceRef('f2')).toBe(2)
    expect(parseFaceRef('zh')).toBeNull()
  })
})

describe('collectTexts', () => {
  it('answers the artwork own words, and the translation through the slot', () => {
    const one = balloon('a', ['何言ってんの'], ['typed'], CHOSEN('t1', ['from slot']))
    const pages = collectTexts([file('p1', pageOf(one.blocks, { [ZH]: [one.unit] }))], ZH_ONLY)
    expect(pages).toEqual([
      {
        pageId: 'p1',
        no: 1,
        name: '001.jpg',
        badge: 'ok',
        faces: [
          {
            faceId: ZH,
            faceNo: 1,
            name: '譯文',
            sentences: [
              {
                id: 'u-a',
                no: 1,
                sources: [{ no: 1, text: '何言ってんの' }],
                translation: 'from slot',
                blocks: [
                  {
                    id: 'at',
                    no: 1,
                    refs: ['p1/1', 'p1/1.1'],
                    text: 'from slot',
                    candidates: [
                      { id: 't1', letter: 'a', text: 'from slot', human: false, chosen: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  /** ⭐ A split sentence is written to by block, so every block has to be addressable. */
  it('gives each block of a sentence set in several its own address and drawer', () => {
    const source = src('s', ['ゴゴゴ'])
    const first = tr('t1', ZH, ['轟'], CHOSEN('c1', ['轟隆']))
    const second = tr('t2', ZH, ['隆'])
    const unit: TranslationUnit = { id: 'u-a', members: [source.id, first.id, second.id] }
    const [page] = collectTexts([file('p1', pageOf([source, first, second], { [ZH]: [unit] }))], ZH_ONLY)
    expect(page.faces[0].sentences[0]).toMatchObject({
      no: 1,
      translation: '轟隆/隆',
      blocks: [
        { id: 't1', no: 1, refs: ['p1/1.1'], text: '轟隆' },
        { id: 't2', no: 2, refs: ['p1/1.2'], text: '隆', candidates: [] },
      ],
    })
  })

  /** ⭐ Every face is listed under its own number: the number writes, the name reads. */
  it('lists every face, each with its own sentences, or only the one asked for', () => {
    const source = src('s', ['何言ってんの'])
    const zh = tr('z', ZH, ['你在說什麼啊'])
    const en = tr('e', EN, ['What are you saying'])
    const page = pageOf([source, zh, en], {
      [ZH]: [{ id: 'u-zh', members: [source.id, zh.id] }],
      [EN]: [{ id: 'u-en', members: [source.id, en.id] }],
    })
    const [collected] = collectTexts([file('p1', page)], FACES)
    expect(collected.faces.map((f) => [f.faceNo, f.name])).toEqual([
      [1, '譯文'],
      [2, 'English'],
    ])
    const [only] = collectTexts([file('p1', page)], FACES, undefined, EN)
    expect(only.faces.map((f) => f.faceId)).toEqual([EN])
    expect(only.faces[0].sentences[0].blocks[0].refs).toEqual(['p1/1', 'p1/1.1'])
  })

  it('walks sentences in reading order and keeps damaged pages listed but empty', () => {
    const a = balloon('a', [], [])
    const b = balloon('b', [], [])
    const page = pageOf([...a.blocks, ...b.blocks], { [ZH]: [b.unit, a.unit] })
    const damaged = file('p2', pageOf([], { [ZH]: [] }, '002.jpg'), 'damaged')
    const pages = collectTexts([file('p1', page), damaged], ZH_ONLY)
    expect(pages[0].faces[0].sentences.map((s) => s.no)).toEqual([1, 2])
    expect(pages[0].faces[0].sentences.map((s) => s.id)).toEqual(['u-b', 'u-a'])
    expect(pages[1]).toEqual({ pageId: 'p2', no: 2, name: '002.jpg', badge: 'damaged', faces: [] })
  })

  /** ⚠️ A page read alone still says where it reads in the chapter. */
  it("reads only the pages asked for, keeping the chapter's own numbering", () => {
    const files = ['p1', 'p2', 'p3'].map((id) => file(id, pageOf([], { [ZH]: [] })))
    const some = collectTexts(files, ZH_ONLY, ['p3', 'p1', 'nope'])
    expect(some.map((p) => [p.pageId, p.no])).toEqual([
      ['p1', 1],
      ['p3', 3],
    ])
  })
})

describe('resolveRef', () => {
  const source = src('s', ['ゴゴゴ'])
  const split = [tr('t1', ZH, ['轟']), tr('t2', ZH, ['隆'])]
  const one = tr('e', EN, [], { candidates: [{ id: 'c1', lines: ['Rumble'] }], chosen: 'c1' })
  const page = pageOf([source, ...split, one], {
    [ZH]: [{ id: 'u-zh', members: [source.id, 't1', 't2'] }],
    [EN]: [{ id: 'u-en', members: [source.id, one.id] }],
  })

  it('takes a block of a split sentence, and a whole sentence set in one block', () => {
    expect(resolveRef(page, 'p1', FACES[0], parseRef('p1/1.2')!)).toMatchObject({
      place: { block: { id: 't2' }, blockRef: 'p1/1.2' },
    })
    expect(resolveRef(page, 'p1', FACES[1], parseRef('p1/1')!)).toMatchObject({
      place: { block: { id: 'e' }, blockRef: 'p1/1' },
    })
  })

  it('takes a candidate by its letter', () => {
    const found = resolveRef(page, 'p1', FACES[1], parseRef('p1/1a')!)
    expect('place' in found && found.place.candidate?.id).toBe('c1')
  })

  /** ⚠️ Nothing in the sentence number says which block the words were written for. */
  it('refuses a sentence set in several blocks, naming the blocks to use', () => {
    const found = resolveRef(page, 'p1', FACES[0], parseRef('p1/1')!)
    expect('refusal' in found && found.refusal).toBe(
      'p1/1 的譯文分成 2 塊——請指定是哪一塊：p1/1.1、p1/1.2',
    )
  })

  it('refuses a sentence, a block and a letter the page does not have', () => {
    const sentence = resolveRef(page, 'p1', FACES[0], parseRef('p1/9')!)
    expect('refusal' in sentence && sentence.refusal).toBe('p1 的 f1 沒有第 9 句')
    const block = resolveRef(page, 'p1', FACES[0], parseRef('p1/1.5')!)
    expect('refusal' in block && block.refusal).toBe('p1/1 沒有第 5 塊——它有 p1/1.1、p1/1.2')
    const letter = resolveRef(page, 'p1', FACES[1], parseRef('p1/1c')!)
    expect('refusal' in letter && letter.refusal).toBe('p1/1 的抽屜裡沒有 c——現有 a')
    const empty = resolveRef(page, 'p1', FACES[0], parseRef('p1/1.1a')!)
    expect('refusal' in empty && empty.refusal).toBe('p1/1.1 的抽屜裡沒有 a——抽屜是空的')
  })
})

describe('addressOf', () => {
  it('finds where a block and a candidate live now, in whichever face holds them', () => {
    const source = src('s', [])
    const zh = tr('z', ZH, [], { candidates: [{ id: 'c1', lines: ['甲'] }] })
    const en = tr('e', EN, [])
    const files = [
      file(
        'p1',
        pageOf([source, zh, en], {
          [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
          [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
        }),
      ),
    ]
    expect(addressOf(files, FACES, 'z')).toEqual({ ref: 'p1/1', faceId: ZH, faceNo: 1 })
    expect(addressOf(files, FACES, 'c1')).toEqual({ ref: 'p1/1a', faceId: ZH, faceNo: 1 })
    expect(addressOf(files, FACES, 'e')).toEqual({ ref: 'p1/1', faceId: EN, faceNo: 2 })
    expect(addressOf(files, FACES, 'nowhere')).toBeNull()
  })
})

describe('renderTexts', () => {
  it('renders a script a model can read', () => {
    const source = src('s1', ['一日くらい', 'ならー'])
    const lettering = tr('t1', ZH, [], {
      candidates: [
        { id: 'c1', lines: ['放任一天也好——'], human: true },
        { id: 'c2', lines: ['放著一天不管也行'], source: 'claude-code 2.1.219' },
      ],
      chosen: 'c1',
    })
    const laugh = src('s2', ['にへへ～'])
    const first = tr('t2', ZH, [], { candidates: [{ id: 'c3', lines: ['嘻'], human: true }], chosen: 'c3' })
    const second = tr('t3', ZH, ['嘿'])
    const page = pageOf([source, lettering, laugh, first, second], {
      [ZH]: [
        { id: 'u1', members: ['s1', 't1'] },
        { id: 'u2', members: ['s2', 't2', 't3'] },
      ],
    })
    const rendered = renderTexts(collectTexts([file('p7', page)], ZH_ONLY), {
      caller: 'claude-code 2.1.219',
    })
    expect(rendered).toBe(
      [
        '專案 · 1 頁 · 2 句',
        '',
        '第 1 頁 · p7 · 001.jpg · f1 譯文 · 2 句',
        '1  原文 s1 一日くらい⏎ならー',
        '    譯文 放任一天也好——',
        '    候選 a✓「放任一天也好——」（human） ／ b 「放著一天不管也行」（你）',
        '2  原文 s2 にへへ～',
        '    譯文 嘻/嘿',
        '    2.1 嘻  候選 a✓「嘻」（human）',
        '    2.2 嘿  （抽屜空）',
      ].join('\n'),
    )
  })

  it('says the empty answers out loud and keeps a damaged page in the list', () => {
    const rendered = renderTexts(
      [
        {
          pageId: 'p1',
          no: 1,
          name: '001.jpg',
          badge: 'ok',
          faces: [
            {
              faceId: ZH,
              faceNo: 1,
              name: '譯文',
              sentences: [{ id: 'a', no: 1, sources: [], translation: '', blocks: [] }],
            },
          ],
        },
        { pageId: 'p2', no: 2, name: '002.jpg', badge: 'damaged', faces: [] },
      ],
      { missing: ['p9'] },
    )
    expect(rendered).toContain('沒有這些頁：p9')
    expect(rendered).toContain('1  原文 （無）')
    expect(rendered).toContain('    譯文 （未翻）')
    expect(rendered).toContain('    （這一面還沒有譯文方塊）')
    expect(rendered).toContain('第 2 頁 · p2 · 002.jpg ·（damaged，內容不可讀）')
  })
})

describe('what one session was shown', () => {
  const sentence = (no: number, translation: string): SentenceTexts => ({
    id: `u${no}`,
    no,
    sources: [],
    translation,
    blocks: [
      { id: `t${no}`, no: 1, refs: [`p1/${no}`, `p1/${no}.1`], text: translation, candidates: [] },
    ],
  })
  const face = (faceId: string, sentences: SentenceTexts[]): FaceTexts => ({
    faceId,
    faceNo: faceId === ZH ? 1 : 2,
    name: faceId === ZH ? '譯文' : 'English',
    sentences,
  })
  const page = (pageId: string, faces: FaceTexts[]): PageTexts => ({
    pageId,
    no: 1,
    name: '001.jpg',
    badge: 'ok',
    faces,
  })

  it('answers everything the first time, then only what reads differently and what is gone', () => {
    const seen: SeenTexts = new Map()
    const before = [page('p1', [face(ZH, [sentence(1, '甲'), sentence(2, '乙'), sentence(3, '丙')])])]
    expect(sinceSeen(seen, before, undefined).pages).toEqual(before)
    noteSeen(seen, before, undefined, true)

    const after = [page('p1', [face(ZH, [sentence(1, '甲'), sentence(2, '乙改')])])]
    const since = sinceSeen(seen, after, undefined)
    expect(since.pages[0].faces[0].sentences.map((s) => s.no)).toEqual([2])
    expect(since.gone).toEqual(new Map([['p1', new Map([[ZH, ['p1/3']]])]]))

    noteSeen(seen, after, undefined, true)
    expect(sinceSeen(seen, after, undefined).pages).toEqual([])
  })

  /** ⚠️ Sentence numbers are a face's own, so one face cannot answer for another. */
  it('keeps each face apart', () => {
    const seen: SeenTexts = new Map()
    noteSeen(seen, [page('p1', [face(ZH, [sentence(1, '甲')]), face(EN, [sentence(1, 'A')])])], undefined, true)
    const since = sinceSeen(
      seen,
      [page('p1', [face(ZH, [sentence(1, '甲')]), face(EN, [sentence(1, 'B')])])],
      undefined,
    )
    expect(since.pages[0].faces.map((f) => f.faceId)).toEqual([EN])
  })

  it("takes a write's reply as seen without forgetting the rest of the page", () => {
    const seen: SeenTexts = new Map()
    noteSeen(seen, [page('p1', [face(ZH, [sentence(1, '甲'), sentence(2, '乙')])])], undefined, true)
    noteSeen(seen, [page('p1', [face(ZH, [sentence(1, '甲改')])])], undefined, false)

    const since = sinceSeen(
      seen,
      [page('p1', [face(ZH, [sentence(1, '甲改'), sentence(2, '乙')])])],
      undefined,
    )
    expect(since.pages).toEqual([])
    expect(since.gone.size).toBe(0)
  })

  /** ⭐ Both spellings of a one-block sentence are remembered, or one of them writes unchecked. */
  it('remembers which object every address it showed stood for', () => {
    const memory: RefMemory = new Map()
    noteRefs(memory, [
      page('p1', [
        face(ZH, [
          {
            id: 'u1',
            no: 1,
            sources: [],
            translation: '甲',
            blocks: [
              {
                id: 'blk',
                no: 1,
                refs: ['p1/1', 'p1/1.1'],
                text: '甲',
                candidates: [{ id: 'cand', letter: 'a', text: '甲', human: false, chosen: true }],
              },
            ],
          },
        ]),
      ]),
    ])
    expect(seenIdsFor(memory, 'p1/1')).toEqual({ [ZH]: 'blk' })
    expect(seenIdsFor(memory, 'p1/1.1')).toEqual({ [ZH]: 'blk' })
    expect(seenIdsFor(memory, 'p1/1a')).toEqual({ [ZH]: 'cand' })
    expect(seenIdsFor(memory, 'p1/1.1a')).toEqual({ [ZH]: 'cand' })
    expect(seenIdsFor(memory, 'p1/2')).toBeUndefined()
  })
})

describe('planWithdraw', () => {
  const CLIENT = 'claude-code 2.1.219'
  const candidates: TranslationCandidate[] = [
    { id: 'mine', lines: ['本 client 提的'], source: CLIENT },
    { id: 'theirs', lines: ['別的 client 提的'], source: 'codex 1.0' },
    { id: 'yours', lines: ['人寫的'], human: true },
    { id: 'old', lines: ['署名機制前的'] },
  ]
  const drawer = (chosen: string | null = null) => tr('t', ZH, [], { candidates, chosen })
  const held = (id: string) => candidates.find((c) => c.id === id)!

  it('removes a candidate stamped with the same client, chosen or not', () => {
    expect(planWithdraw(drawer(), held('mine'), CLIENT)).toEqual({ action: 'remove', wasChosen: false })
    expect(planWithdraw(drawer('mine'), held('mine'), CLIENT)).toEqual({
      action: 'remove',
      wasChosen: true,
    })
  })

  it('refuses everything that is not its own stamp', () => {
    expect(planWithdraw(drawer(), held('yours'), CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), held('theirs'), CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), held('old'), CLIENT).action).toBe('refuse')
    expect(planWithdraw(drawer(), held('mine'), undefined).action).toBe('refuse')
  })
})

describe('write replies', () => {
  const state: PageTexts[] = [
    {
      pageId: 'p1',
      no: 1,
      name: '001.jpg',
      badge: 'ok',
      faces: [
        {
          faceId: ZH,
          faceNo: 1,
          name: '譯文',
          sentences: [
            {
              id: 'u1',
              no: 1,
              sources: [{ no: 1, text: 'ゴゴゴ' }],
              translation: '新譯',
              blocks: [
                {
                  id: 't1',
                  no: 1,
                  refs: ['p1/1', 'p1/1.1'],
                  text: '新譯',
                  candidates: [{ id: 'c1', letter: 'a', text: '新譯', human: false, chosen: true }],
                },
              ],
            },
          ],
        },
      ],
    },
  ]

  it('says what landed, what took effect, what was refused, then the state', () => {
    const rendered = renderProposeResult({
      outcomes: [
        { ref: 'p1/1', ok: true, candidateRef: 'p1/1a', filledSlot: true },
        { ref: 'p1/2.1', ok: true, candidateRef: 'p1/2.1c', filledSlot: false },
        { ref: 'p1/9', ok: false, reason: 'p1 的 f1 沒有第 9 句' },
      ],
      pages: state,
    })
    expect(rendered).toContain('收下 2 則，拒絕 1 則')
    expect(rendered).toContain('p1/1 → 候選 p1/1a（已生效）')
    expect(rendered).toContain('p1/2.1 → 候選 p1/2.1c（進入抽屜，現值未動）')
    expect(rendered).toContain('p1/9 ✗ p1 的 f1 沒有第 9 句')
    expect(rendered).toContain('操作後的狀態：')
    expect(rendered).toContain('第 1 頁 · p1 · 001.jpg · f1 譯文 · 1 句')
    expect(rendered).toContain('    候選 a✓「新譯」（AI）')
  })

  it('reports each withdrawal and whether a slot cleared', () => {
    const rendered = renderWithdrawResult({
      outcomes: [
        { ref: 'p1/1a', ok: true, clearedSlot: true },
        { ref: 'p1/1b', ok: false, reason: '這是人寫過的候選——不可撤' },
      ],
      pages: [],
    })
    expect(rendered).toContain('p1/1a 已撤回（原為現值，方塊已回退為自己的字）')
    expect(rendered).toContain('p1/1b ✗ 這是人寫過的候選——不可撤')
  })
})
