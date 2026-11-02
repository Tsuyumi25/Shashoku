import type {
  ChooseItem,
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
import { collectTexts, resolveObject, textsOfUnit, type ObjectPlace } from './collect'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'

function openProject() {
  const project = useProjectStore()
  if (!project.isOpen) throw new Error('沒有開啟中的專案')
  return project
}

type Project = ReturnType<typeof useProjectStore>

/**
 * Why a page takes no writes, or null when it does. Asked per item: a batch
 * that reaches a damaged page refuses what lands there and still writes the
 * rest, which is what each item's outcome is for.
 */
function pageRefusal(project: Project, pageId: string): string | null {
  const file = project.pageById(pageId)
  if (!file) return `頁 ${pageId} 不存在`
  if (file.badge !== 'ok') return `頁 ${pageId} 是 ${file.badge}，拒絕寫入`
  return null
}

/** The page, face and block an item names, or the reason it names nothing writable. */
function placeOf(project: Project, pageId: string, objectId: string): ObjectPlace | string {
  const refused = pageRefusal(project, pageId)
  if (refused !== null) return refused
  const found = resolveObject(project.pageById(pageId)!.page, project.faceIds, objectId)
  return 'refusal' in found ? found.refusal : found.place
}

/**
 * The touched sentences' state as of after the batch, page by page and face by
 * face in first-touch order. Whole sentences rather than the blocks named, so
 * a caller that wrote one piece of a split sentence sees what the whole of it
 * now reads as.
 */
function statesOf(project: Project, touched: readonly { pageId: string; objectId: string }[]): PageTexts[] {
  const pages = new Map<string, PageTexts>()
  const seen = new Set<string>()
  for (const { pageId, objectId } of touched) {
    const file = project.pageById(pageId)
    if (!file) continue
    const found = resolveObject(file.page, project.faceIds, objectId)
    if ('refusal' in found) continue
    const { face, unit } = found.place
    const key = `${pageId}\u0000${face}\u0000${unit.id}`
    if (seen.has(key)) continue
    seen.add(key)
    let page = pages.get(pageId)
    if (!page) {
      page = { pageId, badge: file.badge, faces: [] }
      pages.set(pageId, page)
    }
    let listed = page.faces.find((f) => f.faceId === face)
    if (!listed) {
      const name = project.faces.find((f) => f.id === face)?.name ?? face
      listed = { faceId: face, name, sentences: [] }
      page.faces.push(listed)
    }
    listed.sentences.push(textsOfUnit(found.place.page, unit))
  }
  return [...pages.values()]
}

async function proposeTranslations(params: ProposeParams): Promise<WriteResult<ProposeOutcome>> {
  const project = openProject()
  const outcomes: ProposeOutcome[] = params.items.map((item) => {
    const { pageId, objectId } = item
    const place = placeOf(project, pageId, objectId)
    if (typeof place === 'string') return { pageId, objectId, ok: false, reason: place }
    const plan = planProposal(place.block, item)
    if (plan.action === 'refuse') return { pageId, objectId, ok: false, reason: plan.reason }
    const translationId = project.addTranslation(pageId, place.block.id, plan.lines, 'model', params.source)
    if (translationId === null) return { pageId, objectId, ok: false, reason: '這一筆翻譯不存在' }
    if (plan.fillSlot) project.setLabelTranslation(pageId, place.block.id, translationId)
    return { pageId, objectId, ok: true, translationId, filledSlot: plan.fillSlot }
  })
  // Landed before the reply: an answer that only reached memory would report
  // success right up until a crash took it back.
  await project.flush()
  return { outcomes, pages: statesOf(project, params.items) }
}

async function chooseTranslation(params: ChooseParams): Promise<WriteResult<ChooseOutcome>> {
  const project = openProject()
  const outcomes: ChooseOutcome[] = params.items.map((item: ChooseItem) => {
    const place = placeOf(project, item.pageId, item.objectId)
    if (typeof place === 'string') return { ...item, ok: false, reason: place }
    if (!place.block.body.candidates.some((c) => c.id === item.translationId)) {
      return { ...item, ok: false, reason: '候選不在這個物件的抽屜裡' }
    }
    project.setLabelTranslation(item.pageId, place.block.id, item.translationId)
    return { ...item, ok: true }
  })
  await project.flush()
  return { outcomes, pages: statesOf(project, params.items) }
}

async function withdrawTranslation(params: WithdrawParams): Promise<WriteResult<WithdrawOutcome>> {
  const project = openProject()
  const outcomes: WithdrawOutcome[] = params.items.map((item: ChooseItem) => {
    const place = placeOf(project, item.pageId, item.objectId)
    if (typeof place === 'string') return { ...item, ok: false, reason: place }
    const plan = planWithdraw(place.block, item.translationId, params.source)
    if (plan.action === 'refuse') return { ...item, ok: false, reason: plan.reason }
    project.removeTranslation(item.pageId, place.block.id, item.translationId)
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
      const project = openProject()
      return collectTexts(project.files, project.faces, params?.pageIds)
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
