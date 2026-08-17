import type {
  ChooseOutcome,
  ChooseParams,
  McpQuery,
  ProposeOutcome,
  ProposeParams,
  TextObjectTexts,
  WithdrawOutcome,
  WithdrawParams,
  WriteResult,
} from '@shared/mcp/types'
import { useProjectStore } from '@/stores/projectStore'
import { collectTexts, readingsOf, textsOfEntry } from './collect'
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

/** The touched objects' state as of after the batch, in first-touch order. */
function statesOf(
  project: ReturnType<typeof useProjectStore>,
  pageId: string,
  objectIds: readonly string[],
): TextObjectTexts[] {
  const file = project.pageById(pageId)
  if (!file) return []
  const readings = readingsOf(file)
  const seen = new Set<string>()
  const out: TextObjectTexts[] = []
  for (const id of objectIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const entry = project.labelById(pageId, id)
    if (entry) out.push(textsOfEntry(entry, readings))
  }
  return out
}

async function proposeTranslations(
  params: ProposeParams,
): Promise<WriteResult<ProposeOutcome>> {
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
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.objectId),
    ),
  }
}

async function chooseTranslation(params: ChooseParams): Promise<WriteResult<ChooseOutcome>> {
  const project = openProject()
  writablePage(project, params.pageId)
  const outcomes: ChooseOutcome[] = params.items.map(({ objectId, translationId }) => {
    const entry = project.labelById(params.pageId, objectId)
    if (!entry) return { objectId, translationId, ok: false, reason: '物件不存在' }
    if (!entry.translations.some((c) => c.id === translationId)) {
      return { objectId, translationId, ok: false, reason: '候選不在這個物件的抽屜裡' }
    }
    project.setLabelTranslation(params.pageId, objectId, translationId)
    return { objectId, translationId, ok: true }
  })
  await project.flush()
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.objectId),
    ),
  }
}

async function withdrawTranslation(
  params: WithdrawParams,
): Promise<WriteResult<WithdrawOutcome>> {
  const project = openProject()
  writablePage(project, params.pageId)
  const outcomes: WithdrawOutcome[] = params.items.map(({ objectId, translationId }) => {
    const entry = project.labelById(params.pageId, objectId)
    const plan = planWithdraw(entry, translationId, params.source)
    if (plan.action === 'refuse') return { objectId, translationId, ok: false, reason: plan.reason }
    project.removeTranslation(params.pageId, objectId, translationId)
    return { objectId, translationId, ok: true, clearedSlot: plan.wasChosen }
  })
  await project.flush()
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.objectId),
    ),
  }
}

/** Exported so tests can drive the same dispatch the bridge drives. */
export async function answer(query: McpQuery): Promise<unknown> {
  switch (query.method) {
    case 'get_texts': {
      return collectTexts(openProject().files)
    }
    case 'propose_translations': {
      return proposeTranslations(query.params as ProposeParams)
    }
    case 'choose_translation': {
      return chooseTranslation(query.params as ChooseParams)
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
