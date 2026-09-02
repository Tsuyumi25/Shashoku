import type {
  ChooseOutcome,
  ChooseParams,
  McpQuery,
  ProposeOutcome,
  ProposeParams,
  TranslationTexts,
  WithdrawOutcome,
  WithdrawParams,
  WriteResult,
} from '@shared/mcp/types'
import { useProjectStore } from '@/stores/projectStore'
import { collectTexts, textsOfUnit } from './collect'
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

/** The touched translations' state as of after the batch, in first-touch order. */
function statesOf(
  project: ReturnType<typeof useProjectStore>,
  pageId: string,
  unitIds: readonly string[],
): TranslationTexts[] {
  const file = project.pageById(pageId)
  if (!file) return []
  const seen = new Set<string>()
  const out: TranslationTexts[] = []
  for (const id of unitIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const unit = project.unitById(pageId, id)
    if (unit) out.push(textsOfUnit(file.page, unit))
  }
  return out
}

async function proposeTranslations(
  params: ProposeParams,
): Promise<WriteResult<ProposeOutcome>> {
  const project = openProject()
  writablePage(project, params.pageId)
  const page = project.pageById(params.pageId)?.page
  const outcomes: ProposeOutcome[] = params.items.map((item) => {
    const unit = project.unitById(params.pageId, item.unitId)
    if (page === undefined) return { unitId: item.unitId, ok: false, reason: '頁面不存在' }
    const plan = planProposal(page, unit, item)
    if (plan.action === 'refuse') {
      return { unitId: item.unitId, ok: false, reason: plan.reason }
    }
    const translationId = project.addTranslation(
      params.pageId,
      item.unitId,
      plan.pieces,
      'model',
      params.source,
    )
    if (translationId === null) {
      return { unitId: item.unitId, ok: false, reason: '這一筆翻譯不存在' }
    }
    if (plan.fillSlot) project.setLabelTranslation(params.pageId, item.unitId, translationId)
    return { unitId: item.unitId, ok: true, translationId, filledSlot: plan.fillSlot }
  })
  // Landed before the reply: an answer that only reached memory would report
  // success right up until a crash took it back.
  await project.flush()
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.unitId),
    ),
  }
}

async function chooseTranslation(params: ChooseParams): Promise<WriteResult<ChooseOutcome>> {
  const project = openProject()
  writablePage(project, params.pageId)
  const outcomes: ChooseOutcome[] = params.items.map(({ unitId, translationId }) => {
    const unit = project.unitById(params.pageId, unitId)
    if (!unit) return { unitId, translationId, ok: false, reason: '這一筆翻譯不存在' }
    const candidate = unit.candidates.find((c) => c.id === translationId)
    if (!candidate) {
      return { unitId, translationId, ok: false, reason: '候選不在這一筆的抽屜裡' }
    }
    // ⚠️ Refused rather than filled part way: a reading with the wrong number
    // of blocks has no block to show some of its words from.
    if (candidate.pieces.length !== unit.translation.members.length) {
      return {
        unitId,
        translationId,
        ok: false,
        reason: `這則候選有 ${candidate.pieces.length} 塊,而這一筆的譯文排成 ${unit.translation.members.length} 塊`,
      }
    }
    project.setLabelTranslation(params.pageId, unitId, translationId)
    return { unitId, translationId, ok: true }
  })
  await project.flush()
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.unitId),
    ),
  }
}

async function withdrawTranslation(
  params: WithdrawParams,
): Promise<WriteResult<WithdrawOutcome>> {
  const project = openProject()
  writablePage(project, params.pageId)
  const outcomes: WithdrawOutcome[] = params.items.map(({ unitId, translationId }) => {
    const unit = project.unitById(params.pageId, unitId)
    const plan = planWithdraw(unit, translationId, params.source)
    if (plan.action === 'refuse') return { unitId, translationId, ok: false, reason: plan.reason }
    project.removeTranslation(params.pageId, unitId, translationId)
    return { unitId, translationId, ok: true, clearedSlot: plan.wasChosen }
  })
  await project.flush()
  return {
    outcomes,
    objects: statesOf(
      project,
      params.pageId,
      params.items.map((i) => i.unitId),
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
