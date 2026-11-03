import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { blankSourceBlock, blankTranslationBlock, defaultManifest, defaultOcr } from '@shared/page/schema'
import { numberPage } from '@shared/page/numbers'
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
  ChooseParams,
  PageTexts,
  ProposeItem,
  ProposeOutcome,
  WithdrawOutcome,
  WithdrawParams,
  WriteRef,
  WriteResult,
} from '@shared/mcp/types'
import { renderTexts } from '@shared/mcp/render'
import { answer } from './answers'

const PAGE_ID = 'p1'
const CLIENT = 'claude-code 2.1.219'
const ZH = 'zh'
const EN = 'en'
const FACES: TranslationFace[] = [
  { id: ZH, no: 1, name: '譯文' },
  { id: EN, no: 2, name: 'English' },
]

type Project = ReturnType<typeof useProjectStore>

function src(id: string, lines: string[] = []) {
  const block = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
  block.body.lines = lines
  return block
}

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
  return {
    blocks: [src(`${id}s`), tr(id, ZH, words, over)],
    unit: { id: `u-${id}`, members: [`${id}s`, id] },
  }
}

function openWith(
  project: Project,
  blocks: TextLayerEntry[],
  ledgers: Record<string, TranslationUnit[]>,
  badge: ProjectFile['badge'] = 'ok',
): ManifestJson {
  project.rootPath = '/root'
  project.projectMeta.faces = FACES
  const page: ManifestJson = defaultManifest('001.jpg', 1200, 1700)
  page.layers = blocks
  for (const [face, units] of Object.entries(ledgers)) page.ledgers[face] = { units }
  const sources = new Set(blocks.flatMap((b) => (b.side === 'source' ? [b.id] : [])))
  page.readingOrder =
    Object.values(ledgers)[0]?.flatMap((u) => u.members.filter((id) => sources.has(id))) ?? []
  numberPage(page, [ZH, EN])
  project.allFiles = [
    { pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge },
  ]
  return page
}

/** One 譯文 balloon, which is what most of these only need. */
function openOne(
  project: Project,
  one: { blocks: TextLayerEntry[]; unit: TranslationUnit },
  badge: ProjectFile['badge'] = 'ok',
) {
  openWith(project, one.blocks, { [ZH]: [one.unit] }, badge)
}

const writePage = vi.fn(async () => {})
const writeProjectMeta = vi.fn(async () => {})

function propose(items: (Omit<ProposeItem, 'ref'> & { ref: string })[], face?: string) {
  return answer({
    id: 'q',
    method: 'propose_translations',
    params: { face, items, source: CLIENT },
  }) as Promise<WriteResult<ProposeOutcome>>
}

function choose(items: WriteRef[], face?: string) {
  return answer({
    id: 'q',
    method: 'choose_translation',
    params: { face, items } satisfies ChooseParams,
  }) as Promise<WriteResult<ChooseOutcome>>
}

function withdraw(items: WriteRef[]) {
  return answer({
    id: 'q',
    method: 'withdraw_translation',
    params: { items, source: CLIENT } satisfies WithdrawParams,
  }) as Promise<WriteResult<WithdrawOutcome>>
}

function drawerOf(project: Project, blockId: string): TranslationBody {
  return (project.blockById(PAGE_ID, blockId) as TranslationTextLayerEntry).body
}

function refusalOf(outcome: { ok: boolean }): string {
  return 'reason' in outcome ? String(outcome.reason) : '（沒有拒絕）'
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
    const result = await propose([{ ref: 'p1/1', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { ref: 'p1/1', ok: false, reason: 'p1 是 damaged，拒絕寫入' },
    ])
    expect(writePage).not.toHaveBeenCalled()
  })

  /** ⭐ The shorthand: an ordinary balloon is written to by the sentence's own number. */
  it('proposes through the sentence address: stamped, filled, flushed, state attached', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([{ ref: 'p1/1', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { ref: 'p1/1', ok: true, candidateRef: 'p1/1a', filledSlot: true },
    ])
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('新譯')
    expect(sentence.blocks[0].candidates[0]).toMatchObject({ letter: 'a', source: CLIENT, chosen: true })
    expect(result.pages[0]).toMatchObject({ pageId: 'p1', no: 1, name: '001.jpg' })
    expect(writePage).toHaveBeenCalledTimes(1)
  })

  it('takes the explicit block spelling of a one-block sentence too', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([{ ref: 'p1/1.1', lines: ['新譯'] }])
    expect(result.outcomes[0]).toMatchObject({ ok: true, candidateRef: 'p1/1a' })
  })

  it('puts a proposal in place over a settled choice when asked to, keeping the old one', async () => {
    const project = useProjectStore()
    openOne(project, label('a', [], { candidates: [{ id: 't1', lines: ['舊譯'], human: true }], chosen: 't1' }))
    const result = await propose([{ ref: 'p1/1', lines: ['新譯'], choose: true }])
    expect(result.outcomes[0]).toMatchObject({ ok: true, candidateRef: 'p1/1b', filledSlot: true })
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('新譯')
    expect(sentence.blocks[0].candidates.map((c) => c.letter)).toEqual(['a', 'b'])
  })

  it('reports per item and lists each touched sentence once', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([
      { ref: 'p1/1', lines: ['一稿'] },
      { ref: 'p1/1', lines: ['二稿'] },
      { ref: 'p1/9', lines: ['x'] },
      { ref: '這不是位址', lines: ['x'] },
    ])
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, false, false])
    expect(refusalOf(result.outcomes[2])).toBe('p1 的 f1 沒有第 9 句')
    expect(refusalOf(result.outcomes[3])).toContain('看不懂的位址 這不是位址')
    expect(result.pages[0].faces[0].sentences.map((s) => s.no)).toEqual([1])
    expect(result.pages[0].faces[0].sentences[0].blocks[0].candidates).toHaveLength(2)
  })

  /** ⭐ A split sentence is written to by block, and each block keeps its own drawer. */
  it('lands a proposal in the named block of a sentence set in several', async () => {
    const project = useProjectStore()
    openWith(project, [src('s'), tr('t1', ZH, ['轟']), tr('t2', ZH)], {
      [ZH]: [{ id: 'u-a', members: ['s', 't1', 't2'] }],
    })
    const result = await propose([{ ref: 'p1/1.2', lines: ['隆'] }])
    expect(result.outcomes[0]).toMatchObject({ ok: true, candidateRef: 'p1/1.2a', filledSlot: true })
    expect(project.blockById(PAGE_ID, 't1')!.body).toMatchObject({ candidates: [] })
    expect(result.pages[0].faces[0].sentences[0]).toMatchObject({
      translation: '轟/隆',
      blocks: [
        { no: 1, refs: ['p1/1.1'], text: '轟' },
        { no: 2, refs: ['p1/1.2'], text: '隆' },
      ],
    })
  })

  /** ⚠️ Nothing in the sentence number says which of its blocks the words were meant for. */
  it('refuses a sentence address where the sentence is set in several blocks', async () => {
    const project = useProjectStore()
    openWith(project, [src('s'), tr('t1', ZH), tr('t2', ZH)], {
      [ZH]: [{ id: 'u-a', members: ['s', 't1', 't2'] }],
    })
    const result = await propose([{ ref: 'p1/1', lines: ['隆'] }])
    expect(refusalOf(result.outcomes[0])).toBe(
      'p1/1 的譯文分成 2 塊——請指定是哪一塊：p1/1.1、p1/1.2',
    )
    expect(project.blockById(PAGE_ID, 't1')!.body).toMatchObject({ candidates: [] })
  })

  it('refuses a candidate address given to propose, and a block address given to choose', async () => {
    const project = useProjectStore()
    openOne(project, label('a', [], { candidates: [{ id: 'c1', lines: ['甲'] }] }))
    const proposed = await propose([{ ref: 'p1/1a', lines: ['乙'] }])
    expect(refusalOf(proposed.outcomes[0])).toBe(
      'propose_translations 要的是句子或方塊的位址（像 p7/14、p7/14.2），不是候選——請去掉 p1/1a 後面的字母',
    )
    const chosen = await choose([{ ref: 'p1/1' }])
    expect(refusalOf(chosen.outcomes[0])).toBe(
      'choose_translation 要的是候選的位址（像 p7/14b、p7/14.2b）——請在 p1/1 後面加上候選的字母',
    )
  })

  it('chooses by the letter the drawer shows, and refuses a letter that is not in it', async () => {
    const project = useProjectStore()
    openOne(
      project,
      label('a', [], {
        candidates: [
          { id: 'c1', lines: ['甲'] },
          { id: 'c2', lines: ['乙'] },
        ],
        chosen: 'c1',
      }),
    )
    const result = await choose([{ ref: 'p1/1b' }, { ref: 'p1/1d' }])
    expect(result.outcomes[0]).toEqual({ ref: 'p1/1b', ok: true })
    expect(refusalOf(result.outcomes[1])).toBe('p1/1 的抽屜裡沒有 d——現有 a、b')
    expect(drawerOf(project, 'a').chosen).toBe('c2')
    expect(result.pages[0].faces[0].sentences[0].translation).toBe('乙')
  })

  it('withdraws by letter, clears the slot it held and says so, then flushes', async () => {
    const project = useProjectStore()
    openOne(
      project,
      label('a', ['自己的字'], {
        candidates: [{ id: 'mine', lines: ['本 client 提的'], source: CLIENT }],
        chosen: 'mine',
      }),
    )
    const result = await withdraw([{ ref: 'p1/1a' }])
    expect(result.outcomes[0]).toEqual({ ref: 'p1/1a', ok: true, clearedSlot: true })
    const sentence = result.pages[0].faces[0].sentences[0]
    expect(sentence.translation).toBe('自己的字')
    expect(sentence.blocks[0].candidates).toHaveLength(0)
    expect(writePage).toHaveBeenCalledTimes(1)
  })

  /** ⭐ Every face is readable and writable, and one call works in exactly one of them. */
  it('reads both faces and writes into the one the call names', async () => {
    const project = useProjectStore()
    openWith(project, [src('s', ['何言ってんの']), tr('z', ZH, ['你在說什麼啊']), tr('e', EN)], {
      [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
      [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
    })
    const pages = (await answer({ id: 'q', method: 'get_texts' })) as PageTexts[]
    const rendered = renderTexts(pages, { caller: CLIENT })
    expect(rendered).toContain('第 1 頁 · p1 · 001.jpg · f1 譯文 · 1 句')
    expect(rendered).toContain('第 1 頁 · p1 · 001.jpg · f2 English · 1 句')

    const result = await propose([{ ref: 'p1/1', lines: ['What are you on about'] }], 'f2')
    expect(result.outcomes[0]).toMatchObject({ ok: true, candidateRef: 'p1/1a' })
    expect(result.pages[0].faces[0]).toMatchObject({ faceId: EN, faceNo: 2, name: 'English' })
    expect(drawerOf(project, 'z')).toMatchObject({ candidates: [] })
    expect(drawerOf(project, 'e').candidates).toHaveLength(1)
  })

  it('writes into the face an address names, whatever face the call names', async () => {
    const project = useProjectStore()
    openWith(project, [src('s', ['何言ってんの']), tr('z', ZH), tr('e', EN)], {
      [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
      [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
    })
    const result = await propose(
      [
        { ref: 'p1/f2/1', lines: ['What are you on about'] },
        { ref: 'p1/f9/1', lines: ['nowhere'] },
      ],
      'f1',
    )
    expect(result.outcomes[0]).toMatchObject({ ok: true })
    expect(drawerOf(project, 'e').candidates).toHaveLength(1)
    expect(drawerOf(project, 'z').candidates).toEqual([])
    expect(refusalOf(result.outcomes[1]!)).toBe('沒有 f9 這一面——這本書的面有：f1 譯文、f2 English')
  })

  it('refuses an address the session was only shown in another face, naming the face', async () => {
    const project = useProjectStore()
    openWith(project, [src('s', ['何言ってんの']), tr('z', ZH), tr('e', EN)], {
      [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
      [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
    })
    const result = await propose([{ ref: 'p1/1', lines: ['What are you on about'], seen: { [EN]: 'e' } }])
    expect(refusalOf(result.outcomes[0]!)).toBe(
      'p1/1 是你在 f2 English 讀到的，這次呼叫卻是 f1——請寫成 p1/f2/1，或在呼叫裡帶 face: "f2"',
    )
    expect(drawerOf(project, 'z').candidates).toEqual([])
  })

  it('reads only the face asked for, and refuses a face the project does not have', async () => {
    const project = useProjectStore()
    openWith(project, [src('s'), tr('z', ZH), tr('e', EN)], {
      [ZH]: [{ id: 'u-zh', members: ['s', 'z'] }],
      [EN]: [{ id: 'u-en', members: ['s', 'e'] }],
    })
    const pages = (await answer({
      id: 'q',
      method: 'get_texts',
      params: { face: 'f2' },
    })) as PageTexts[]
    expect(pages[0].faces.map((f) => f.faceId)).toEqual([EN])
    await expect(
      answer({ id: 'q', method: 'get_texts', params: { face: 'f9' } }),
    ).rejects.toThrow('沒有 f9 這一面——這個專案有 f1 譯文、f2 English')
  })

  it('refuses a page the project does not have', async () => {
    const project = useProjectStore()
    openOne(project, label('a'))
    const result = await propose([{ ref: 'p9/1', lines: ['x'] }])
    expect(refusalOf(result.outcomes[0])).toBe('沒有 p9 這一頁')
  })

  /**
   * ⭐ The whole of how a regrouped page is caught: the project records nothing
   * about a number changing hands, so the session's own memory is the evidence.
   */
  it('refuses an address whose block has since moved, and says where it went', async () => {
    const project = useProjectStore()
    const page = openWith(project, [src('s1'), tr('t1', ZH), src('s2'), tr('t2', ZH), tr('t3', ZH)], {
      [ZH]: [
        { id: 'u1', members: ['s1', 't1'] },
        { id: 'u2', members: ['s2', 't2', 't3'] },
      ],
    })
    const units = page.ledgers[ZH].units
    units[0].members = ['s1', 't3']
    units[1].members = ['s2', 't2', 't1']
    numberPage(page, [ZH, EN])

    const moved = await propose([{ ref: 'p1/1', lines: ['x'], seen: { [ZH]: 't1' } }])
    expect(refusalOf(moved.outcomes[0])).toBe('p1/1 現在指的是別的東西：它原本的那一塊現在是 p1/2.3')
    expect(project.blockById(PAGE_ID, 't3')!.body).toMatchObject({ candidates: [] })

    const still = await propose([{ ref: 'p1/2.3', lines: ['x'], seen: { [ZH]: 't1' } }])
    expect(still.outcomes[0]).toMatchObject({ ok: true })
  })

  it('refuses an address whose sentence is gone, and one whose object is gone with it', async () => {
    const project = useProjectStore()
    const page = openWith(project, [src('s1'), tr('t1', ZH), src('s2'), tr('t2', ZH)], {
      [ZH]: [
        { id: 'u1', members: ['s1', 't1'] },
        { id: 'u2', members: ['s2', 't2'] },
      ],
    })
    page.layers = page.layers.filter((l) => l.id !== 't1')
    page.ledgers[ZH].units = page.ledgers[ZH].units.filter((u) => u.id !== 'u1')
    numberPage(page, [ZH, EN])

    const result = await propose([
      { ref: 'p1/1', lines: ['x'], seen: { [ZH]: 't1' } },
      { ref: 'p1/1', lines: ['x'] },
    ])
    expect(refusalOf(result.outcomes[0])).toBe(
      'p1/1 已經不在了：它原本的那一塊已經不在這個專案裡了',
    )
    expect(refusalOf(result.outcomes[1])).toBe('p1 的 f1 沒有第 1 句')
  })

  it('refuses a candidate address the session saw under a candidate that has gone', async () => {
    const project = useProjectStore()
    openOne(project, label('a', [], { candidates: [{ id: 'c1', lines: ['甲'] }] }))
    const result = await choose([{ ref: 'p1/1a', seen: { [ZH]: 'withdrawn' } }])
    expect(refusalOf(result.outcomes[0])).toBe(
      'p1/1a 現在指的是別的東西：它原本的那則候選已經不在這個專案裡了',
    )
    expect(drawerOf(project, 'a').chosen).toBeNull()
  })
})
