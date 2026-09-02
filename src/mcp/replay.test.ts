import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry, TranslationUnit } from '@shared/page/types'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'
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
  said: { unit: TranslationUnit; blocks: TextLayerEntry[] },
) {
  project.rootPath = '/root'
  const page = defaultManifest('p', 1200, 1700)
  page.layers.push(...said.blocks)
  page.translationUnits.push(said.unit)
  page.readingOrder.push(said.unit.id)
  project.allFiles = [{ pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge: 'ok' }]
}

/** What answers.ts does for one propose item, without the IPC around it. */
function propose(project: ReturnType<typeof useProjectStore>, unitId: string, lines: string[]) {
  const page = project.pageById(PAGE_ID)!.page
  const unit = project.unitById(PAGE_ID, unitId)
  const plan = planProposal(page, unit, { unitId, lines })
  if (plan.action === 'refuse') throw new Error(plan.reason)
  const id = project.addTranslation(PAGE_ID, unitId, plan.pieces, 'model', CLIENT)
  if (plan.fillSlot && id) project.setLabelTranslation(PAGE_ID, unitId, id)
  return id!
}

function withdraw(project: ReturnType<typeof useProjectStore>, unitId: string, id: string) {
  const plan = planWithdraw(project.unitById(PAGE_ID, unitId), id, CLIENT)
  if (plan.action === 'refuse') throw new Error(plan.reason)
  project.removeTranslation(PAGE_ID, unitId, id)
}

describe('replaying the field sequence', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('never moves a human-held slot through propose ×6 and withdraw ×3', () => {
    const project = useProjectStore()
    openWith(
      project,
      label('obj', {
        candidates: [
          { id: 'h-test', pieces: [['測試']], human: true },
          { id: 'h-empty', pieces: [['']], human: true },
        ],
        chosen: 'h-test',
      }),
    )
    const typos = ['靳自己', '召喛A', '召喛B'].map((t) => propose(project, 'u-obj', [t]))
    ;['靠自己', '召喚A', '召喚B'].forEach((t) => propose(project, 'u-obj', [t]))
    typos.forEach((id) => withdraw(project, 'u-obj', id))

    const unit = project.unitById(PAGE_ID, 'u-obj')!
    expect(unit.chosen).toBe('h-test')
    expect(unit.candidates.map((c) => c.pieces[0][0])).toEqual([
      '測試',
      '',
      '靠自己',
      '召喚A',
      '召喚B',
    ])
  })

  it('never moves a null slot over typed lines either', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { words: ['測試'] }))
    const first = propose(project, 'u-obj', ['靳自己'])
    propose(project, 'u-obj', ['靠自己'])
    withdraw(project, 'u-obj', first)
    expect(project.unitById(PAGE_ID, 'u-obj')!.chosen).toBeNull()
  })

  it('does fill the slot exactly once when the object reads as nothing', () => {
    const project = useProjectStore()
    openWith(project, label('obj'))
    const a = propose(project, 'u-obj', ['甲'])
    propose(project, 'u-obj', ['乙'])
    expect(project.unitById(PAGE_ID, 'u-obj')!.chosen).toBe(a)
  })

  it('withdrawing the chosen own candidate falls the object back to its lines', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { words: ['自己打的'] }))
    const a = propose(project, 'u-obj', ['模型版'])
    project.setLabelTranslation(PAGE_ID, 'u-obj', a)
    withdraw(project, 'u-obj', a)
    expect(project.unitById(PAGE_ID, 'u-obj')!.chosen).toBeNull()
    expect(project.blockById(PAGE_ID, 'obj')!.body.lines).toEqual(['自己打的'])
  })

  it('drawer mutations reach a computed watcher without reselecting', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { candidates: [{ id: 'm1', pieces: [['甲']], source: CLIENT }] }))
    const rows = computed(() =>
      project.unitById(PAGE_ID, 'u-obj')!.candidates.map((c) => c.id),
    )
    expect(rows.value).toEqual(['m1'])
    project.removeTranslation(PAGE_ID, 'u-obj', 'm1')
    expect(rows.value).toEqual([])
    project.addTranslation(PAGE_ID, 'u-obj', [['乙']], 'model', CLIENT)
    expect(rows.value).toHaveLength(1)
  })
})
