import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry } from '@shared/page/types'
import type { ProjectFile } from '@/types/project'
import type {
  ChooseOutcome,
  ProposeOutcome,
  WithdrawOutcome,
  WriteResult,
} from '@shared/mcp/types'
import { answer } from './answers'

const PAGE_ID = 'p1'
const CLIENT = 'claude-code 2.1.219'

function label(id: string, extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
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

function openWith(
  project: ReturnType<typeof useProjectStore>,
  entries: TextLayerEntry[],
  badge: ProjectFile['badge'] = 'ok',
) {
  project.rootPath = '/root'
  const page = defaultManifest('p', 1200, 1700)
  for (const entry of entries) {
    page.layers.push(entry)
    page.readingOrder.push(entry.id)
  }
  project.files = [
    { pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge },
  ]
}

const writePage = vi.fn(async () => {})
const writeProjectMeta = vi.fn(async () => {})

function propose(items: { objectId: string; lines: string[] }[]) {
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
    await expect(propose([{ objectId: 'a', lines: ['新譯'] }])).rejects.toThrow('拒絕寫入')
    expect(writePage).not.toHaveBeenCalled()
  })

  it('proposes through the real path: stamped, filled, flushed, state attached', async () => {
    const project = useProjectStore()
    openWith(project, [label('a')])
    const result = await propose([{ objectId: 'a', lines: ['新譯'] }])
    expect(result.outcomes).toEqual([
      { objectId: 'a', ok: true, translationId: expect.any(String), filledSlot: true },
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
      { objectId: 'a', lines: ['一稿'] },
      { objectId: 'a', lines: ['二稿'] },
      { objectId: 'gone', lines: ['x'] },
    ])
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, false])
    expect(result.objects.map((o) => o.id)).toEqual(['a'])
    expect(result.objects[0].candidates).toHaveLength(2)
  })

  it('choose refuses a candidate outside the drawer and moves the slot to one inside', async () => {
    const project = useProjectStore()
    openWith(project, [
      label('a', {
        translations: [
          { id: 't1', lines: ['甲'] },
          { id: 't2', lines: ['乙'] },
        ],
        translation: 't1',
      }),
    ])
    const result = (await answer({
      id: 'q',
      method: 'choose_translation',
      params: {
        pageId: PAGE_ID,
        items: [
          { objectId: 'a', translationId: 'elsewhere' },
          { objectId: 'a', translationId: 't2' },
        ],
      },
    })) as WriteResult<ChooseOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: '候選不在這個物件的抽屜裡' })
    expect(result.outcomes[1]).toMatchObject({ ok: true, translationId: 't2' })
    expect(result.objects[0].translation).toBe('乙')
  })

  it('withdraw clears the slot it held and says so, then flushes', async () => {
    const project = useProjectStore()
    openWith(project, [
      label('a', {
        lines: ['自己的字'],
        translations: [{ id: 'mine', lines: ['本 client 提的'], source: CLIENT }],
        translation: 'mine',
      }),
    ])
    const result = (await answer({
      id: 'q',
      method: 'withdraw_translation',
      params: {
        pageId: PAGE_ID,
        items: [{ objectId: 'a', translationId: 'mine' }],
        source: CLIENT,
      },
    })) as WriteResult<WithdrawOutcome>
    expect(result.outcomes[0]).toMatchObject({ ok: true, clearedSlot: true })
    expect(result.objects[0].translation).toBe('自己的字')
    expect(result.objects[0].candidates).toHaveLength(0)
    expect(writePage).toHaveBeenCalledTimes(1)
  })
})
