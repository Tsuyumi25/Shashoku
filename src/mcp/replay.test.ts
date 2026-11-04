import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import {
  blankSourceBlock,
  blankTranslationBlock,
  defaultManifest,
  defaultOcr,
  treesFromOneTree,
} from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TranslationBody, TranslationTextLayerEntry } from '@shared/page/types'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'

const PAGE_ID = 'p1'
const CLIENT = 'claude-code 2.1.219'
const FACE = 'zh'
const BLOCK = 'obj'

type Project = ReturnType<typeof useProjectStore>

/** One balloon of one face, open in the store, ready to be written to. */
function openWith(project: Project, words: string[] = [], over: Partial<TranslationBody> = {}) {
  project.rootPath = '/root'
  project.projectMeta.faces = [{ id: FACE, no: 1, name: '譯文' }]
  const artwork = blankSourceBlock('src', DEFAULT_TEXT_STYLE)
  const lettering = blankTranslationBlock(BLOCK, FACE, DEFAULT_TEXT_STYLE)
  lettering.body = { ...lettering.body, lines: words, ...over }
  const page = defaultManifest('p', 1200, 1700)
  Object.assign(page, treesFromOneTree([artwork, lettering], [FACE], FACE))
  page.ledgers[FACE] = { units: [{ id: 'u-obj', members: [artwork.id, lettering.id] }] }
  page.readingOrder = [artwork.id]
  project.allFiles = [{ pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge: 'ok' }]
}

function letteringOf(project: Project): TranslationTextLayerEntry {
  return project.blockById(PAGE_ID, BLOCK) as TranslationTextLayerEntry
}

/** What answers.ts does for one propose item, without the IPC around it. */
function propose(project: Project, lines: string[]) {
  const plan = planProposal(letteringOf(project), { lines })
  if (plan.action === 'refuse') throw new Error(plan.reason)
  const id = project.addTranslation(PAGE_ID, BLOCK, plan.lines, 'model', CLIENT)
  if (plan.fillSlot && id) project.setLabelTranslation(PAGE_ID, BLOCK, id)
  return id!
}

function withdraw(project: Project, id: string) {
  const block = letteringOf(project)
  const candidate = block.body.candidates.find((c) => c.id === id)
  if (!candidate) throw new Error(`沒有候選 ${id}`)
  const plan = planWithdraw(block, candidate, CLIENT)
  if (plan.action === 'refuse') throw new Error(plan.reason)
  project.removeTranslation(PAGE_ID, BLOCK, id)
}

describe('replaying the field sequence', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('never moves a human-held slot through propose ×6 and withdraw ×3', () => {
    const project = useProjectStore()
    openWith(project, [], {
      candidates: [
        { id: 'h-test', lines: ['測試'], human: true },
        { id: 'h-empty', lines: [''], human: true },
      ],
      chosen: 'h-test',
    })
    const typos = ['靳自己', '召喛A', '召喛B'].map((t) => propose(project, [t]))
    ;['靠自己', '召喚A', '召喚B'].forEach((t) => propose(project, [t]))
    typos.forEach((id) => withdraw(project, id))

    const block = letteringOf(project)
    expect(block.body.chosen).toBe('h-test')
    expect(block.body.candidates.map((c) => c.lines[0])).toEqual([
      '測試',
      '',
      '靠自己',
      '召喚A',
      '召喚B',
    ])
  })

  it('never moves a null slot over typed lines either', () => {
    const project = useProjectStore()
    openWith(project, ['測試'])
    const first = propose(project, ['靳自己'])
    propose(project, ['靠自己'])
    withdraw(project, first)
    expect(letteringOf(project).body.chosen).toBeNull()
  })

  it('does fill the slot exactly once when the block reads as nothing', () => {
    const project = useProjectStore()
    openWith(project)
    const a = propose(project, ['甲'])
    propose(project, ['乙'])
    expect(letteringOf(project).body.chosen).toBe(a)
  })

  it('withdrawing the chosen own candidate falls the block back to its lines', () => {
    const project = useProjectStore()
    openWith(project, ['自己打的'])
    const a = propose(project, ['模型版'])
    project.setLabelTranslation(PAGE_ID, BLOCK, a)
    withdraw(project, a)
    expect(letteringOf(project).body.chosen).toBeNull()
    expect(letteringOf(project).body.lines).toEqual(['自己打的'])
  })

  it('drawer mutations reach a computed watcher without reselecting', () => {
    const project = useProjectStore()
    openWith(project, [], { candidates: [{ id: 'm1', lines: ['甲'], source: CLIENT }] })
    const rows = computed(() => letteringOf(project).body.candidates.map((c) => c.id))
    expect(rows.value).toEqual(['m1'])
    project.removeTranslation(PAGE_ID, BLOCK, 'm1')
    expect(rows.value).toEqual([])
    project.addTranslation(PAGE_ID, BLOCK, ['乙'], 'model', CLIENT)
    expect(rows.value).toHaveLength(1)
  })
})
