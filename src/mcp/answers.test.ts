import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { blankSourceBlock, blankTranslationBlock, defaultManifest, defaultOcr } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type {
  ManifestJson,
  TextLayerEntry,
  TranslationBody,
  TranslationTextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import type { TranslationFace } from '@shared/project/types'
import type { ProjectFile } from '@/types/project'
import type {
  ChooseOutcome,
  PageTexts,
  ProposeOutcome,
  WithdrawOutcome,
  WriteResult,
} from '@shared/mcp/types'
import { renderTexts } from '@shared/mcp/render'
import { answer } from './answers'

const PAGE_ID = 'p1'
const CLIENT = 'claude-code 2.1.219'
const ZH = 'zh'
const EN = 'en'
const FACES: TranslationFace[] = [
  { id: ZH, name: '譯文' },
  { id: EN, name: 'English' },
]

function tr(
  id: string,
  face: string,
  lines: string[] = [],
  over: Partial<TranslationBody> = {},
): TranslationTextLayerEntry {
  const block = blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
  block.body = { ...block.body, lines, ...over }
  return block
}

/** One ordinary balloon in 譯文: a block of artwork, a block of lettering, and the unit holding them. */
function label(
  id: string,
  words: string[] = [],
  over: Partial<TranslationBody> = {},
): { blocks: TextLayerEntry[]; unit: TranslationUnit } {
  const artwork = blankSourceBlock(`${id}s`, DEFAULT_TEXT_STYLE)
  const lettering = tr(id, ZH, words, over)
  return { blocks: [artwork, lettering], unit: { id: `u-${id}`, members: [artwork.id, lettering.id] } }
}

function openWith(
  project: ReturnType<typeof useProjectStore>,
  blocks: TextLayerEntry[],
  ledgers: Record<string, TranslationUnit[]>,
  badge: ProjectFile['badge'] = 'ok',
) {
  project.rootPath = '/root'
  project.projectMeta.faces = FACES
  const page: ManifestJson = defaultManifest('p', 1200, 1700)
  page.layers = blocks
  for (const [face, units] of Object.entries(ledgers)) {
    page.ledgers[face] = { units, readingOrder: units.map((u) => u.id), readingEdges: [] }
  }
  project.allFiles = [
    { pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge },
  ]
}

/** One 譯文 balloon, which is what most of these only need. */
function openOne(
  project: ReturnType<typeof useProjectStore>,
  one: { blocks: TextLayerEntry[]; unit: TranslationUnit },
  badge: ProjectFile['badge'] = 'ok',
) {
  openWith(project, one.blocks, { [ZH]: [one.unit] }, badge)
}

const writePage = vi.fn(async () => {})
const writeProjectMeta = vi.fn(async () => {})

function propose(items: { objectId: string; lines: string[]; choose?: boolean }[]) {
  return answer({
    id: 'q',
    method: 'propose_translations',
    params: { items: items.map((i) => ({ pageId: PAGE_ID, ...i })), source: CLIENT },
  }) as Promise<WriteResult<ProposeOutcome>>
}

describe('answer — the orchestration the bridge drives', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    writePage.mockClear()
    writeProjectMeta.mockClear()
    vi.stubGlobal('window', { api: { writePage, writeProjectMeta } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refuses every method without an open project', async () => {
    await expect(answer({ id: 'q', method: 'get_texts' })).rejects.toThrow('沒有開啟中的專案')
  })

  it('refuses the items on a damaged page and leaves it unwritten', async () => {
    const project = useProjectStore()
    openOne(project, label('a'), 'damaged')
    const result = await propose([{ objectId: 'u-a', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { pageId: PAGE_ID, objectId: 'u-a', ok: false, reason: `頁 ${PAGE_ID} 是 damaged，拒絕寫入` },
    ])
    expect(writePage).not.toHaveBeenCalled()
  })

  it('proposes through the real path: stamped, filled, flushed, state attached', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([{ objectId: 'u-a', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { pageId: PAGE_ID, objectId: 'u-a', ok: true, translationId: expect.any(String), filledSlot: true },
    ])
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('新譯')
    expect(sentence.candidates[0]).toMatchObject({ source: CLIENT, chosen: true })
    expect(writePage).toHaveBeenCalledTimes(1)
  })

  it('puts a proposal in place over a settled choice when asked to, keeping the old one', async () => {
    const project = useProjectStore()
    openOne(project, label('a', [], { candidates: [{ id: 't1', lines: ['舊譯'], human: true }], chosen: 't1' }))
    const result = await propose([{ objectId: 'u-a', lines: ['新譯'], choose: true }])
    expect(result.outcomes[0]).toMatchObject({ ok: true, filledSlot: true })
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('新譯')
    expect(sentence.candidates.map((c) => c.id)).toContain('t1')
  })

  it('reports per item and lists each touched sentence once', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([
      { objectId: 'u-a', lines: ['一稿'] },
      { objectId: 'u-a', lines: ['二稿'] },
      { objectId: 'gone', lines: ['x'] },
    ])
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, false])
    expect(result.pages[0].faces[0].sentences.map((s) => s.id)).toEqual(['u-a'])
    expect(result.pages[0].faces[0].sentences[0].candidates).toHaveLength(2)
  })

  /** ⭐ A split sentence is written to by block, and each block keeps its own drawer. */
  it('lands a proposal in the named block of a sentence set in several', async () => {
    const project = useProjectStore()
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
    const first = tr('t1', ZH, ['轟'])
    const second = tr('t2', ZH, [])
    openWith(project, [artwork, first, second], {
      [ZH]: [{ id: 'u-a', members: ['s', 't1', 't2'] }],
    })
    const result = await propose([{ objectId: 't2', lines: ['隆'] }])
    expect(result.outcomes[0]).toMatchObject({ ok: true, filledSlot: true })
    expect(project.blockById(PAGE_ID, 't1')!.body).toMatchObject({ candidates: [] })
    expect(second.body.candidates.map((c) => c.lines)).toEqual([['隆']])
    expect(result.pages[0].faces[0].sentences[0]).toMatchObject({
      translation: '轟/隆',
      blocks: [
        { id: 't1', text: '轟', candidates: [] },
        { id: 't2', text: '隆' },
      ],
    })
  })

  /** ⚠️ Nothing in the sentence id says which of its blocks the words were meant for. */
  it('refuses a sentence id where the sentence is set in several blocks', async () => {
    const project = useProjectStore()
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
    openWith(project, [artwork, tr('t1', ZH), tr('t2', ZH)], {
      [ZH]: [{ id: 'u-a', members: ['s', 't1', 't2'] }],
    })
    const result = await propose([{ objectId: 'u-a', lines: ['隆'] }])
    expect(result.outcomes[0]).toMatchObject({ ok: false })
    expect(result.outcomes[0].ok === false && result.outcomes[0].reason).toContain('請改用塊 id')
    expect(project.blockById(PAGE_ID, 't1')!.body).toMatchObject({ candidates: [] })
  })

  /** ⭐ Every face is readable, named as the person named it. */
  it('reads both faces of a page, each under its own name', async () => {
    const project = useProjectStore()
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
    artwork.body.lines = ['何言ってんの']
    const zh = tr('z', ZH, ['你在說什麼啊'])
    const en = tr('e', EN, [], { candidates: [{ id: 'c1', lines: ['What are you on about'] }], chosen: 'c1' })
    openWith(project, [artwork, zh, en], {
      [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
      [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
    })
    const pages = (await answer({ id: 'q', method: 'get_texts' })) as PageTexts[]
    expect(pages[0].faces.map((f) => f.name)).toEqual(['譯文', 'English'])
    const rendered = renderTexts(pages, { caller: CLIENT })
    expect(rendered).toContain('頁 p1 · 譯文 · 1 句')
    expect(rendered).toContain('頁 p1 · English · 1 句')
    expect(rendered).toContain('譯文: What are you on about')
  })

  it('choose refuses a candidate outside the drawer and moves the slot to one inside', async () => {
    const project = useProjectStore()
    openOne(
      project,
      label('a', [], {
        candidates: [
          { id: 't1', lines: ['甲'] },
          { id: 't2', lines: ['乙'] },
        ],
        chosen: 't1',
      }),
    )
    const result = (await answer({
      id: 'q',
      method: 'choose_translation',
      params: {
        items: [
          { pageId: PAGE_ID, objectId: 'u-a', translationId: 'elsewhere' },
          { pageId: PAGE_ID, objectId: 'u-a', translationId: 't2' },
          { pageId: 'nowhere', objectId: 'u-a', translationId: 't2' },
        ],
      },
    })) as WriteResult<ChooseOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: '候選不在這個物件的抽屜裡' })
    expect(result.outcomes[1]).toMatchObject({ ok: true, translationId: 't2' })
    expect(result.outcomes[2]).toMatchObject({ ok: false, reason: '頁 nowhere 不存在' })
    expect(result.pages[0].faces[0].sentences[0].translation).toBe('乙')
  })

  it('withdraw clears the slot it held and says so, then flushes', async () => {
    const project = useProjectStore()
    openOne(
      project,
      label('a', ['自己的字'], {
        candidates: [{ id: 'mine', lines: ['本 client 提的'], source: CLIENT }],
        chosen: 'mine',
      }),
    )
    const result = (await answer({
      id: 'q',
      method: 'withdraw_translation',
      params: {
        items: [{ pageId: PAGE_ID, objectId: 'u-a', translationId: 'mine' }],
        source: CLIENT,
      },
    })) as WriteResult<WithdrawOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: true, clearedSlot: true })
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('自己的字')
    expect(sentence.candidates).toHaveLength(0)
    expect(writePage).toHaveBeenCalledTimes(1)
  })
})
