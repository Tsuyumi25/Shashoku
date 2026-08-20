import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry } from '@shared/page/types'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'

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

function openWith(project: ReturnType<typeof useProjectStore>, entry: TextLayerEntry) {
  project.rootPath = '/root'
  const page = defaultManifest('p', 1200, 1700)
  page.layers.push(entry)
  page.readingOrder.push(entry.id)
  project.allFiles = [{ pageId: PAGE_ID, pageDir: '/root/p1', page, ocr: defaultOcr(1200, 1700), badge: 'ok' }]
}

/** What answers.ts does for one propose item, without the IPC around it. */
function propose(project: ReturnType<typeof useProjectStore>, objectId: string, lines: string[]) {
  const entry = project.labelById(PAGE_ID, objectId)
  const plan = planProposal(entry, lines)
  if (plan.action === 'refuse') throw new Error(plan.reason)
  const id = project.addTranslation(PAGE_ID, objectId, lines, 'model', CLIENT)
  if (plan.fillSlot && id) project.setLabelTranslation(PAGE_ID, objectId, id)
  return id!
}

function withdraw(project: ReturnType<typeof useProjectStore>, objectId: string, id: string) {
  const entry = project.labelById(PAGE_ID, objectId)
  const plan = planWithdraw(entry, id, CLIENT)
  if (plan.action === 'refuse') throw new Error(plan.reason)
  project.removeTranslation(PAGE_ID, objectId, id)
}

describe('replaying the field sequence', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('never moves a human-held slot through propose ×6 and withdraw ×3', () => {
    const project = useProjectStore()
    openWith(
      project,
      label('obj', {
        translations: [
          { id: 'h-test', lines: ['測試'], human: true },
          { id: 'h-empty', lines: [''], human: true },
        ],
        translation: 'h-test',
      }),
    )
    const typos = ['靳自己', '召喛A', '召喛B'].map((t) => propose(project, 'obj', [t]))
    ;['靠自己', '召喚A', '召喚B'].forEach((t) => propose(project, 'obj', [t]))
    typos.forEach((id) => withdraw(project, 'obj', id))

    const entry = project.labelById(PAGE_ID, 'obj')!
    expect(entry.translation).toBe('h-test')
    expect(entry.translations.map((c) => c.lines[0])).toEqual([
      '測試',
      '',
      '靠自己',
      '召喚A',
      '召喚B',
    ])
  })

  it('never moves a null slot over typed lines either', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { lines: ['測試'] }))
    const first = propose(project, 'obj', ['靳自己'])
    propose(project, 'obj', ['靠自己'])
    withdraw(project, 'obj', first)
    expect(project.labelById(PAGE_ID, 'obj')!.translation).toBeNull()
  })

  it('does fill the slot exactly once when the object reads as nothing', () => {
    const project = useProjectStore()
    openWith(project, label('obj'))
    const a = propose(project, 'obj', ['甲'])
    propose(project, 'obj', ['乙'])
    expect(project.labelById(PAGE_ID, 'obj')!.translation).toBe(a)
  })

  it('withdrawing the chosen own candidate falls the object back to its lines', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { lines: ['自己打的'] }))
    const a = propose(project, 'obj', ['模型版'])
    project.setLabelTranslation(PAGE_ID, 'obj', a)
    withdraw(project, 'obj', a)
    const entry = project.labelById(PAGE_ID, 'obj')!
    expect(entry.translation).toBeNull()
    expect(entry.lines).toEqual(['自己打的'])
  })

  it('drawer mutations reach a computed watcher without reselecting', () => {
    const project = useProjectStore()
    openWith(project, label('obj', { translations: [{ id: 'm1', lines: ['甲'], source: CLIENT }] }))
    const rows = computed(() => project.labelById(PAGE_ID, 'obj')!.translations.map((c) => c.id))
    expect(rows.value).toEqual(['m1'])
    project.removeTranslation(PAGE_ID, 'obj', 'm1')
    expect(rows.value).toEqual([])
    project.addTranslation(PAGE_ID, 'obj', ['乙'], 'model', CLIENT)
    expect(rows.value).toHaveLength(1)
  })
})
