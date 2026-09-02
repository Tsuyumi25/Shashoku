import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry, TranslationUnit } from '@shared/page/types'
import type { ProjectFile } from '@/types/project'
import type {
  ChooseOutcome,
  ProposeOutcome,
  WithdrawOutcome,
  WriteResult,
} from '@shared/mcp/types'
import { answer } from './answers'
import { blankBlock } from '@shared/page/schema'

const PAGE_ID = 'p1'
const CLIENT = 'claude-code 2.1.219'

/** One ordinary translation, and the two blocks that say it. */
function label(
  id: string,
  over: { words?: string[] } & Partial<TranslationUnit> = {},
): { unit: TranslationUnit; blocks: TextLayerEntry[] } {
  const { words, ...rest } = over
  const lettering = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  lettering.body.lines = words ?? []
  const artwork = blankBlock(`${id}s`, 'source', DEFAULT_TEXT_STYLE)
  return {
    unit: {
      id: `u-${id}`,
      tags: [],
      source: { members: [artwork.id], separators: [] },
      translation: { members: [lettering.id], separators: [] },
      candidates: [],
      chosen: null,
      ...rest,
    },
    blocks: [lettering, artwork],
  }
}

function openWith(
  project: ReturnType<typeof useProjectStore>,
  said: { unit: TranslationUnit; blocks: TextLayerEntry[] }[],
  badge: ProjectFile['badge'] = 'ok',
) {
  project.rootPath = '/root'
  const page = defaultManifest('p', 1200, 1700)
  for (const one of said) {
    page.layers.push(...one.blocks)
    page.translationUnits.push(one.unit)
    page.readingOrder.push(one.unit.id)
  }
  project.allFiles = [
    { pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge },
  ]
}

const writePage = vi.fn(async () => {})
const writeProjectMeta = vi.fn(async () => {})

function propose(items: { unitId: string; lines: string[] }[]) {
  return answer({
    id: 'q',
    method: 'propose_translations',
    params: { pageId: PAGE_ID, items, source: CLIENT },
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
    await expect(
      answer({ id: 'q', method: 'get_texts' }),
    ).rejects.toThrow('沒有開啟中的專案')
  })

  it('refuses the whole batch before touching a damaged page', async () => {
    const project = useProjectStore()
    openWith(project, [label('a')], 'damaged')
    await expect(propose([{ unitId: 'u-a', lines: ['新譯'] }])).rejects.toThrow('拒絕寫入')
    expect(writePage).not.toHaveBeenCalled()
  })

  it('proposes through the real path: stamped, filled, flushed, state attached', async () => {
    const project = useProjectStore()
    openWith(project, [label('a')])
    const result = await propose([{ unitId: 'u-a', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { unitId: 'u-a', ok: true, translationId: expect.any(String), filledSlot: true },
    ])
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].translation).toBe('新譯')
    expect(result.objects[0].candidates[0]).toMatchObject({ source: CLIENT, chosen: true })
    expect(writePage).toHaveBeenCalledTimes(1)
  })

  it('reports per item and lists each touched object once', async () => {
    const project = useProjectStore()
    openWith(project, [label('a')])
    const result = await propose([
      { unitId: 'u-a', lines: ['一稿'] },
      { unitId: 'u-a', lines: ['二稿'] },
      { unitId: 'gone', lines: ['x'] },
    ])
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, false])
    expect(result.objects.map((o) => o.id)).toEqual(['u-a'])
    expect(result.objects[0].candidates).toHaveLength(2)
  })

  it('choose refuses a candidate outside the drawer and moves the slot to one inside', async () => {
    const project = useProjectStore()
    openWith(project, [
      label('a', {
        candidates: [
          { id: 't1', pieces: [['甲']] },
          { id: 't2', pieces: [['乙']] },
        ],
        chosen: 't1',
      }),
    ])
    const result = (await answer({
      id: 'q',
      method: 'choose_translation',
      params: {
        pageId: PAGE_ID,
        items: [
          { unitId: 'u-a', translationId: 'elsewhere' },
          { unitId: 'u-a', translationId: 't2' },
        ],
      },
    })) as WriteResult<ChooseOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: '候選不在這一筆的抽屜裡' })
    expect(result.outcomes[1]).toMatchObject({ ok: true, translationId: 't2' })
    expect(result.objects[0].translation).toBe('乙')
  })

  it('withdraw clears the slot it held and says so, then flushes', async () => {
    const project = useProjectStore()
    openWith(project, [
      label('a', {
        words: ['自己的字'],
        candidates: [{ id: 'mine', pieces: [['本 client 提的']], source: CLIENT }],
        chosen: 'mine',
      }),
    ])
    const result = (await answer({
      id: 'q',
      method: 'withdraw_translation',
      params: {
        pageId: PAGE_ID,
        items: [{ unitId: 'u-a', translationId: 'mine' }],
        source: CLIENT,
      },
    })) as WriteResult<WithdrawOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: true, clearedSlot: true })
    expect(result.objects[0].translation).toBe('自己的字')
    expect(result.objects[0].candidates).toHaveLength(0)
    expect(writePage).toHaveBeenCalledTimes(1)
  })
})
