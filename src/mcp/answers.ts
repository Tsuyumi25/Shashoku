import type {
  ChooseOutcome,
  ChooseParams,
  GetTextsAnswer,
  GetTextsParams,
  McpQuery,
  PageTexts,
  ProposeOutcome,
  ProposeParams,
  SetTagsOutcome,
  SetTagsParams,
  SetTagsResult,
  TagRegistration,
  WithdrawOutcome,
  WithdrawParams,
  WriteRef,
  WriteResult,
} from '@shared/mcp/types'
import { formatRef, parseFaceRef, parseRef, REF_SYNTAX, type TextRef } from '@shared/mcp/refs'
import { letterOf } from '@shared/page/numbers'
import { facePage } from '@shared/page/units'
import type { TranslationFace } from '@shared/project/types'
import { normalizeTagSet, tagNameRefusal } from '@shared/tags/set'
import { useProjectStore } from '@/stores/projectStore'
import { addressOf, collectTexts, resolveRef, textsOfUnit, type RefPlace } from './collect'
import { planProposal } from './propose'
import { planWithdraw } from './withdraw'

function openProject() {
  const project = useProjectStore()
  if (!project.isOpen) throw new Error('沒有開啟中的專案')
  return project
}

type Project = ReturnType<typeof useProjectStore>

/**
 * Which face the call works in. Named or not, it is one face for the whole
 * batch: a sentence number belongs to a face, so a batch spanning several
 * would have every number meaning two things at once.
 */
function faceOf(project: Project, named: string | undefined): TranslationFace {
  const listed = project.faces.map((f) => `f${f.no} ${f.name}`).join('、')
  if (named === undefined) {
    const active = project.faces.find((f) => f.id === project.activeFace)
    if (!active) throw new Error('這個專案還沒有翻譯面')
    return active
  }
  const no = parseFaceRef(named)
  const found = no === null ? undefined : project.faces.find((f) => f.no === no)
  if (!found) throw new Error(`沒有 ${named} 這一面——這個專案有 ${listed}`)
  return found
}

type Need = 'block' | 'candidate'

function shapeRefusal(ref: TextRef, raw: string, need: Need, tool: string): string | null {
  if (need === 'block' && ref.candidate !== undefined) {
    return `${tool} 要的是句子或方塊的位址（像 p7/14、p7/14.2），不是候選——請去掉 ${raw} 後面的字母`
  }
  if (need === 'candidate' && ref.candidate === undefined) {
    return `${tool} 要的是候選的位址（像 p7/14b、p7/14.2b）——請在 ${raw} 後面加上候選的字母`
  }
  return null
}

/**
 * What the session was shown under this address is not what it names now.
 * Numbers are never reissued, so this is a page regrouped or an object
 * deleted since — and the answer says where the thing itself went, which is
 * the only way back to it without a full re-read.
 */
function staleRefusal(
  project: Project,
  face: TranslationFace,
  raw: string,
  ref: TextRef,
  seenId: string,
  resolves: boolean,
): string {
  const noun = ref.candidate === undefined ? '那一塊' : '那則候選'
  const opener = resolves ? `${raw} 現在指的是別的東西` : `${raw} 已經不在了`
  const where = addressOf(project.files, project.faces, seenId)
  if (where === null) return `${opener}：它原本的${noun}已經不在這個專案裡了`
  const elsewhere = where.faceId === face.id ? '' : `（在 f${where.faceNo} 面）`
  return `${opener}：它原本的${noun}現在是 ${where.ref}${elsewhere}`
}

/** The face and page an address writes into, or the reason it reaches neither. */
function targetOf(
  project: Project,
  callFace: TranslationFace,
  item: WriteRef,
  ref: TextRef,
): { face: TranslationFace; file: Project['files'][number] } | string {
  // A face written in the address is the one it means, whatever the call names.
  const face = ref.face === undefined ? callFace : project.faces.find((f) => f.no === ref.face)
  if (face === undefined) {
    const listed = project.faces.map((f) => `f${f.no} ${f.name}`).join('、')
    return `沒有 f${ref.face} 這一面——這本書的面有：${listed}`
  }
  const file = project.files.find((f) => f.pageId === ref.pageId)
  if (!file) return `沒有 ${ref.pageId} 這一頁`
  if (file.badge !== 'ok') return `${ref.pageId} 是 ${file.badge}，拒絕寫入`
  // Numbers are per face: an address this session was only ever shown in
  // another face would land on whatever that number is here.
  if (ref.face === undefined && item.seen !== undefined && item.seen[face.id] === undefined) {
    const shownIn = project.faces.find((f) => item.seen![f.id] !== undefined)
    if (shownIn !== undefined) {
      const full = formatRef({ ...ref, face: shownIn.no })
      return `${item.ref} 是你在 f${shownIn.no} ${shownIn.name} 讀到的，這次呼叫卻是 f${face.no}——請寫成 ${full}，或在呼叫裡帶 face: "f${shownIn.no}"`
    }
  }
  return { face, file }
}

/** The block an item names, or the reason it names nothing writable. */
function placeOf(
  project: Project,
  callFace: TranslationFace,
  item: WriteRef,
  need: Need,
  tool: string,
): RefPlace | string {
  const ref = parseRef(item.ref)
  if (ref === null) return `看不懂的位址 ${item.ref}——${REF_SYNTAX}`
  const shape = shapeRefusal(ref, item.ref, need, tool)
  if (shape !== null) return shape
  const target = targetOf(project, callFace, item, ref)
  if (typeof target === 'string') return target
  const { face, file } = target
  const found = resolveRef(file.page, ref.pageId, face, ref)
  const seenId = item.seen?.[face.id]
  if ('refusal' in found) {
    return seenId === undefined
      ? found.refusal
      : staleRefusal(project, face, item.ref, ref, seenId, false)
  }
  const names = found.place.candidate?.id ?? found.place.block.id
  if (seenId !== undefined && seenId !== names) {
    return staleRefusal(project, face, item.ref, ref, seenId, true)
  }
  return found.place
}

type SentencePlace = Pick<RefPlace, 'pageId' | 'page' | 'unit'>

/**
 * The sentence an item names, for a write about the whole of it, refused when
 * it is not the sentence this session was shown under that number.
 */
function sentencePlaceOf(
  project: Project,
  callFace: TranslationFace,
  item: WriteRef,
  tool: string,
): SentencePlace | string {
  const ref = parseRef(item.ref)
  if (ref === null) return `看不懂的位址 ${item.ref}——${REF_SYNTAX}`
  if (ref.block !== undefined || ref.candidate !== undefined) {
    const sentence = formatRef({ pageId: ref.pageId, sentence: ref.sentence, face: ref.face })
    return `${tool} 寫的是整句，請用句子的位址 ${sentence}`
  }
  const target = targetOf(project, callFace, item, ref)
  if (typeof target === 'string') return target
  const page = facePage(target.file.page, target.face.id)
  const unit = page.units.find((u) => u.no === ref.sentence)
  const seenId = item.seen?.[target.face.id]
  if (seenId !== undefined && unit?.id !== seenId) {
    return `${item.ref} ${unit === undefined ? '已經不在了' : '現在指的是別的句子'}——請重新讀取 get_texts`
  }
  if (unit === undefined) return `${ref.pageId} 的 f${target.face.no} 沒有第 ${ref.sentence} 句`
  return { pageId: ref.pageId, page, unit }
}

/**
 * The touched sentences' state as of after the batch, in first-touch order.
 * Whole sentences rather than the blocks named, so a caller that wrote one
 * piece of a split sentence sees what the whole of it now reads as.
 */
function statesOf(
  project: Project,
  face: TranslationFace,
  places: readonly SentencePlace[],
): PageTexts[] {
  const pages = new Map<string, PageTexts>()
  const done = new Set<string>()
  for (const place of places) {
    const key = `${place.pageId}\u0000${place.unit.id}`
    if (done.has(key)) continue
    done.add(key)
    let page = pages.get(place.pageId)
    if (!page) {
      const at = project.files.findIndex((f) => f.pageId === place.pageId)
      const file = project.files[at]
      if (!file) continue
      page = {
        pageId: place.pageId,
        no: at + 1,
        name: file.page.name,
        badge: file.badge,
        faces: [{ faceId: face.id, faceNo: face.no, name: face.name, sentences: [], edges: [] }],
      }
      pages.set(place.pageId, page)
    }
    page.faces[0].sentences.push(textsOfUnit(place.pageId, place.page, place.unit))
  }
  return [...pages.values()]
}

async function proposeTranslations(params: ProposeParams): Promise<WriteResult<ProposeOutcome>> {
  const project = openProject()
  const face = faceOf(project, params.face)
  const touched: RefPlace[] = []
  const outcomes: ProposeOutcome[] = params.items.map((item) => {
    const place = placeOf(project, face, item, 'block', 'propose_translations')
    if (typeof place === 'string') return { ref: item.ref, ok: false, reason: place }
    const plan = planProposal(place.block, item)
    if (plan.action === 'refuse') return { ref: item.ref, ok: false, reason: plan.reason }
    const id = project.addTranslation(place.pageId, place.block.id, plan.lines, 'model', params.source)
    if (id === null) return { ref: item.ref, ok: false, reason: `${item.ref} 這一塊寫不進去` }
    if (plan.fillSlot) project.setLabelTranslation(place.pageId, place.block.id, id)
    touched.push(place)
    const candidate = place.block.body.candidates.find((c) => c.id === id)
    return {
      ref: item.ref,
      ok: true,
      candidateRef: `${place.blockRef}${letterOf(candidate!.no!)}`,
      filledSlot: plan.fillSlot,
    }
  })
  // Landed before the reply: an answer that only reached memory would report
  // success right up until a crash took it back.
  await project.flush()
  return { outcomes, pages: statesOf(project, face, touched) }
}

async function chooseTranslation(params: ChooseParams): Promise<WriteResult<ChooseOutcome>> {
  const project = openProject()
  const face = faceOf(project, params.face)
  const touched: RefPlace[] = []
  const outcomes: ChooseOutcome[] = params.items.map((item) => {
    const place = placeOf(project, face, item, 'candidate', 'choose_translation')
    if (typeof place === 'string') return { ref: item.ref, ok: false, reason: place }
    project.setLabelTranslation(place.pageId, place.block.id, place.candidate!.id)
    touched.push(place)
    return { ref: item.ref, ok: true }
  })
  await project.flush()
  return { outcomes, pages: statesOf(project, face, touched) }
}

async function withdrawTranslation(params: WithdrawParams): Promise<WriteResult<WithdrawOutcome>> {
  const project = openProject()
  const face = faceOf(project, params.face)
  const touched: RefPlace[] = []
  const outcomes: WithdrawOutcome[] = params.items.map((item) => {
    const place = placeOf(project, face, item, 'candidate', 'withdraw_translation')
    if (typeof place === 'string') return { ref: item.ref, ok: false, reason: place }
    const candidate = place.candidate!
    const plan = planWithdraw(place.block, candidate, params.source)
    if (plan.action === 'refuse') return { ref: item.ref, ok: false, reason: plan.reason }
    project.removeTranslation(place.pageId, place.block.id, candidate.id)
    touched.push(place)
    return { ref: item.ref, ok: true, clearedSlot: plan.wasChosen }
  })
  await project.flush()
  return { outcomes, pages: statesOf(project, face, touched) }
}

/** Registers every name the call used that the registry lacks, and applies the colours it gave. */
function registerTags(project: Project, names: readonly string[], colors: Record<string, string>): TagRegistration[] {
  const registered: TagRegistration[] = []
  for (const name of new Set([...Object.keys(colors), ...names])) {
    const color = colors[name]
    const at = project.header.tags.findIndex((t) => t.name === name)
    if (at === -1) {
      const added = project.addTag(name, color)
      if (added) registered.push({ name, color: added.color, added: true })
    } else if (color !== undefined && project.header.tags[at]!.color !== color) {
      project.setTagColor(at, color)
      registered.push({ name, color, added: false })
    }
  }
  return registered
}

async function setTags(params: SetTagsParams): Promise<SetTagsResult> {
  const project = openProject()
  const face = faceOf(project, params.face)
  const colors = Object.fromEntries(Object.entries(params.colors ?? {}).map(([name, color]) => [name.trim(), color]))
  for (const name of Object.keys(colors)) {
    const refusal = tagNameRefusal(name)
    if (refusal !== null) throw new Error(`colors 裡的${refusal}`)
  }
  const touched: SentencePlace[] = []
  const used: string[] = []
  const outcomes: SetTagsOutcome[] = params.items.map((item) => {
    const refusal = item.tags.map(tagNameRefusal).find((r) => r !== null)
    if (refusal) return { ref: item.ref, ok: false, reason: refusal }
    const place = sentencePlaceOf(project, face, item, 'set_tags')
    if (typeof place === 'string') return { ref: item.ref, ok: false, reason: place }
    const tags = normalizeTagSet(item.tags)
    project.setLabelTags(place.pageId, place.unit.id, tags, face.id)
    touched.push(place)
    used.push(...tags)
    return { ref: item.ref, ok: true, tags }
  })
  const registered = registerTags(project, used, colors)
  await project.flush()
  return {
    outcomes,
    registered,
    pages: statesOf(project, face, touched),
    elsewhere: sharingArtwork(project, face, touched),
  }
}

/** Every other face's sentences that hold any of the artwork these sentences hold, page by page. */
function sharingArtwork(project: Project, face: TranslationFace, places: readonly SentencePlace[]): PageTexts[] {
  const out: PageTexts[] = []
  for (const pageId of new Set(places.map((p) => p.pageId))) {
    const at = project.files.findIndex((f) => f.pageId === pageId)
    const file = project.files[at]
    if (!file) continue
    const artwork = new Set(places.filter((p) => p.pageId === pageId).flatMap((p) => p.unit.members))
    const faces = project.faces
      .filter((f) => f.id !== face.id)
      .map((f) => {
        const page = facePage(file.page, f.id)
        const units = page.units.filter((u) => u.members.some((id) => artwork.has(id)))
        return {
          faceId: f.id,
          faceNo: f.no,
          name: f.name,
          sentences: units.map((u) => textsOfUnit(pageId, page, u)),
          edges: [],
        }
      })
      .filter((f) => f.sentences.length > 0)
    if (faces.length > 0) out.push({ pageId, no: at + 1, name: file.page.name, badge: file.badge, faces })
  }
  return out
}

/** Exported so tests can drive the same dispatch the bridge drives. */
export async function answer(query: McpQuery): Promise<unknown> {
  switch (query.method) {
    case 'get_texts': {
      const params = query.params as GetTextsParams | undefined
      const project = openProject()
      const face = params?.face === undefined ? undefined : faceOf(project, params.face).id
      return {
        folder: project.folderPath!,
        notes: `${project.shashokuDir}/notes`,
        pages: collectTexts(project.files, project.faces, params?.pageIds, face),
      } satisfies GetTextsAnswer
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
    case 'set_tags': {
      return setTags(query.params as SetTagsParams)
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
