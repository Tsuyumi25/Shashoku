import type {
  ChooseParams,
  McpQuery,
  ProposeOutcome,
  ProposeParams,
  WithdrawParams,
} from '@shared/mcp/types'
import { useProjectStore } from '@/stores/projectStore'
import { collectTexts } from './collect'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'

function openProject() {
  const project = useProjectStore()
  if (!project.isOpen) throw new Error('沒有開啟中的專案')
  return project
}

function writablePage(project: ReturnType<typeof useProjectStore>, pageId: string) {
  const file = project.pageById(pageId)
  if (!file) throw new Error(`頁 ${pageId} 不存在`)
  if (file.badge !== 'ok') throw new Error(`頁 ${pageId} 是 ${file.badge}，拒絕寫入`)
  return file
}

async function proposeTranslations(params: ProposeParams): Promise<ProposeOutcome[]> {
  const project = openProject()
  writablePage(project, params.pageId)
  const outcomes: ProposeOutcome[] = params.items.map((item) => {
    const entry = project.labelById(params.pageId, item.objectId)
    const plan = planProposal(entry, item.lines)
    if (plan.action === 'refuse') {
      return { objectId: item.objectId, ok: false, reason: plan.reason }
    }
    const translationId = project.addTranslation(
      params.pageId,
      item.objectId,
      item.lines,
      'model',
      params.source,
    )
    if (translationId === null) {
      return { objectId: item.objectId, ok: false, reason: '物件不存在' }
    }
    if (plan.fillSlot) project.setLabelTranslation(params.pageId, item.objectId, translationId)
    return { objectId: item.objectId, ok: true, translationId, filledSlot: plan.fillSlot }
  })
  // Landed before the reply: an answer that only reached memory would report
  // success right up until a crash took it back.
  await project.flush()
  return outcomes
}

async function chooseTranslation(params: ChooseParams): Promise<void> {
  const project = openProject()
  writablePage(project, params.pageId)
  const entry = project.labelById(params.pageId, params.objectId)
  if (!entry) throw new Error(`物件 ${params.objectId} 不存在`)
  if (!entry.translations.some((c) => c.id === params.translationId)) {
    throw new Error(`候選 ${params.translationId} 不在這個物件的抽屜裡`)
  }
  project.setLabelTranslation(params.pageId, params.objectId, params.translationId)
  await project.flush()
}

async function withdrawTranslation(params: WithdrawParams): Promise<{ clearedSlot: boolean }> {
  const project = openProject()
  writablePage(project, params.pageId)
  const entry = project.labelById(params.pageId, params.objectId)
  const plan = planWithdraw(entry, params.translationId, params.source)
  if (plan.action === 'refuse') throw new Error(plan.reason)
  project.removeTranslation(params.pageId, params.objectId, params.translationId)
  await project.flush()
  return { clearedSlot: plan.wasChosen }
}

async function answer(query: McpQuery): Promise<unknown> {
  switch (query.method) {
    case 'get_texts': {
      return collectTexts(openProject().files)
    }
    case 'propose_translations': {
      return proposeTranslations(query.params as ProposeParams)
    }
    case 'choose_translation': {
      await chooseTranslation(query.params as ChooseParams)
      return null
    }
    case 'withdraw_translation': {
      return withdrawTranslation(query.params as WithdrawParams)
    }
  }
}

export function registerMcpAnswers() {
  window.api.onMcpQuery((query) => {
    void answer(query)
      .then((result) => window.api.mcpReply({ id: query.id, ok: true, result }))
      .catch((err: unknown) => {
        window.api.mcpReply({
          id: query.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  })
}
