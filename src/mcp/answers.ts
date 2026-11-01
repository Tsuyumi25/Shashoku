import type {
  ChooseOutcome,
  ChooseParams,
  GetTextsParams,
  McpQuery,
  PageTexts,
  ProposeOutcome,
  ProposeParams,
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

/**
 * Why a page takes no writes, or null when it does. Asked per item: a batch
 * that reaches a damaged page refuses what lands there and still writes the
 * rest, which is what each item's outcome is for.
 */
function pageRefusal(project: ReturnType<typeof useProjectStore>, pageId: string): string | null {
  const file = project.pageById(pageId)
  if (!file) return `頁 ${pageId} 不存在`
  if (file.badge !== 'ok') return `頁 ${pageId} 是 ${file.badge}，拒絕寫入`
  return null
}

/** The touched translations' state as of after the batch, page by page in first-touch order. */
function statesOf(
  project: ReturnType<typeof useProjectStore>,
  touched: readonly { pageId: string; unitId: string }[],
): PageTexts[] {
  const pages = new Map<string, PageTexts>()
  const seen = new Set<string>()
  for (const { pageId, unitId } of touched) {
    const key = `${pageId}\u0000${unitId}`
    if (seen.has(key)) continue
    seen.add(key)
    const file = project.pageById(pageId)
    const unit = project.unitById(pageId, unitId)
    if (!file || !unit) continue
    let page = pages.get(pageId)
    if (!page) {
      page = { pageId, badge: file.badge, objects: [] }
      pages.set(pageId, page)
    }
    page.objects.push(textsOfUnit(file.page, unit))
  }
  return [...pages.values()]
}

async function proposeTranslations(params: ProposeParams): Promise<WriteResult<ProposeOutcome>> {
  const project = openProject()
  const outcomes: ProposeOutcome[] = params.items.map((item) => {
    const { pageId, unitId } = item
    const refused = pageRefusal(project, pageId)
    if (refused !== null) return { pageId, unitId, ok: false, reason: refused }
    const page = project.pageById(pageId)!.page
    const plan = planProposal(page, project.unitById(pageId, unitId), item)
    if (plan.action === 'refuse') return { pageId, unitId, ok: false, reason: plan.reason }
    const translationId = project.addTranslation(pageId, unitId, plan.pieces, 'model', params.source)
    if (translationId === null) return { pageId, unitId, ok: false, reason: '這一筆翻譯不存在' }
    if (plan.fillSlot) project.setLabelTranslation(pageId, unitId, translationId)
    return { pageId, unitId, ok: true, translationId, filledSlot: plan.fillSlot }
  })
  // Landed before the reply: an answer that only reached memory would report
  // success right up until a crash took it back.
  await project.flush()
  return { outcomes, pages: statesOf(project, params.items) }
}

async function chooseTranslation(params: ChooseParams): Promise<WriteResult<ChooseOutcome>> {
  const project = openProject()
  const outcomes: ChooseOutcome[] = params.items.map((item) => {
    const refused = pageRefusal(project, item.pageId)
    if (refused !== null) return { ...item, ok: false, reason: refused }
    const unit = project.unitById(item.pageId, item.unitId)
    if (!unit) return { ...item, ok: false, reason: '這一筆翻譯不存在' }
    const candidate = unit.candidates.find((c) => c.id === item.translationId)
    if (!candidate) return { ...item, ok: false, reason: '候選不在這一筆的抽屜裡' }
    // ⚠️ Refused rather than filled part way: a reading with the wrong number
    // of blocks has no block to show some of its words from.
    if (candidate.pieces.length !== unit.translation.members.length) {
      return {
        ...item,
        ok: false,
        reason: `這則候選有 ${candidate.pieces.length} 塊,而這一筆的譯文排成 ${unit.translation.members.length} 塊`,
      }
    }
    project.setLabelTranslation(item.pageId, item.unitId, item.translationId)
    return { ...item, ok: true }
  })
  await project.flush()
  return { outcomes, pages: statesOf(project, params.items) }
}

async function withdrawTranslation(params: WithdrawParams): Promise<WriteResult<WithdrawOutcome>> {
  const project = openProject()
  const outcomes: WithdrawOutcome[] = params.items.map((item) => {
    const refused = pageRefusal(project, item.pageId)
    if (refused !== null) return { ...item, ok: false, reason: refused }
    const plan = planWithdraw(project.unitById(item.pageId, item.unitId), item.translationId, params.source)
    if (plan.action === 'refuse') return { ...item, ok: false, reason: plan.reason }
    project.removeTranslation(item.pageId, item.unitId, item.translationId)
    return { ...item, ok: true, clearedSlot: plan.wasChosen }
  })
  await project.flush()
  return { outcomes, pages: statesOf(project, params.items) }
}

/** Exported so tests can drive the same dispatch the bridge drives. */
export async function answer(query: McpQuery): Promise<unknown> {
  switch (query.method) {
    case 'get_texts': {
      const params = query.params as GetTextsParams | undefined
      return collectTexts(openProject().files, params?.pageIds)
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
