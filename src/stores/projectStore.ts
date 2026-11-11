import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ProjectFile, ProjectHeader } from '@/types/project'
import type { ProjectJson, TranslationFace } from '@shared/project/types'
import type { PageEntry } from '@shared/ipc/channels'
import type { TagDefinition } from '@shared/tags/types'
import type {
  GroupLayerEntry,
  LayerEntry,
  ManifestJson,
  NumberCounters,
  OcrCandidatePersisted,
  OcrJson,
  SourceBody,
  TextLayerEntry,
  TranslationCandidate,
  TranslationUnit,
} from '@shared/page/types'
import type { LayerEffect } from '@shared/effects/types'
import { cloneEffects } from '@shared/effects/clone'
import { absorb, type OcrArrival } from '@shared/ocr/pool'
import { PASS_THROUGH } from '@shared/page/types'
import {
  defaultColorForTagIndex,
  defaultProjectJson,
  parseProjectJson,
  serializeProjectJson,
} from '@shared/project/schema'
import {
  blankTranslationBlock,
  defaultOcr,
  generateId,
  parseManifest,
  parseOcr,
  serializeManifest,
  serializeOcr,
  unreadablePage,
  RETOUCH_LAYER_NAME,
} from '@shared/page/schema'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { repairPage } from '@shared/page/repair'
import { copyFace, dropFace } from '@shared/page/faces'
import { numberPage } from '@shared/page/numbers'
import {
  dissolveGroupAt,
  insertAtPath,
  moveEntry,
  pathOf,
  removeAtPath,
  restoreGroupAt,
  textObjects,
  type DropTarget,
} from '@shared/page/tree'
import {
  addFaceEntry,
  addPageEntry,
  entryOnPage,
  everyEntry,
  everyText,
  homeOf,
  isPageEntry,
  linkToPage,
  ownTree,
  removeFromPage,
  resolveTrees,
  snapshotTrees,
  textOnPage,
  unlinkToFace,
  type TreesSnapshot,
} from '@shared/page/trees'
import { linesOf, type TextSide } from '@shared/page/text'
import { adoptSources } from '@shared/page/relink'
import { readAfter, sourceEdgeFor, sourceEdgesUnder, sourceOrder, sourceOrderFor } from '@shared/page/reading'
import {
  emptyLedger,
  facePage,
  findUnit,
  placeOfBlock,
  tagsOfBlock,
  tagsOfUnit,
  unitsInReadingOrder,
  type FacePage,
  type UnitPlace,
} from '@shared/page/units'
import {
  hasEdge,
  normalizeEdges,
  withoutEdges,
  wouldCycle,
  type ReadingEdge,
} from '@shared/page/readingGraph'
import { parentFolder } from '@shared/project/library'
import { applyPageOrderSnapshot } from '@shared/project/pages'
import type { ExportMenuEntry, ExportProfile } from '@shared/export/types'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { SHASHOKU_DIR, layersDirOf } from '@shared/ssk/constants'
import type { TextStyle } from '@shared/text-style/types'
import { normalizeTagSet } from '@shared/tags/set'
import { createAutosave } from '@/lib/autosave'

/** The part of a page that says which blocks make which sentence, in every face. */
export type PageStructure = Pick<ManifestJson, 'ledgers' | 'readingOrder' | 'readingEdges'> & TreesSnapshot

/** A new sentence's blocks and, for every face, the unit holding them. */
export interface TranslationParts {
  blocks: readonly TextLayerEntry[]
  units: Readonly<Record<string, TranslationUnit>>
}

/**
 * A page's structure from before a change, which is what undoing it puts back.
 *
 * Whole rather than piece by piece: a block taken off a page leaves every face's
 * ledger, may take sentences in other faces with it, and the reading of each —
 * putting all that back by recorded paths and indices is where the positional
 * bookkeeping this replaced went wrong.
 */
export interface PageSnapshot {
  pageId: string
  before: PageStructure
}

/** Every page's structure and the face list at one moment. */
export interface FaceState {
  pages: Record<string, PageStructure>
  faces: TranslationFace[]
  activeFace: string
}

/**
 * A ledger for every face, written before the page is reactive: a face's view
 * creates a missing one on first read, and that read is usually a computed.
 */
function withEveryLedger(page: ManifestJson, faces: readonly string[]): void {
  for (const face of faces) page.ledgers[face] ??= emptyLedger()
}

/**
 * A container's counter, carried to the page it moves to, so what it numbered
 * before the move is never numbered again after it.
 */
function carryCounter(from: Record<string, number>, to: Record<string, number>, id: string): void {
  const next = from[id]
  if (next !== undefined) to[id] = Math.max(to[id] ?? 1, next)
}

/** Whether a page on disk was written before the schema this build writes. */
function isOlderManifest(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { schemaVersion?: unknown }).schemaVersion !== MANIFEST_SCHEMA_VERSION
  } catch {
    return false
  }
}



function shashokuDirOf(rootPath: string): string {
  return joinPath(rootPath, SHASHOKU_DIR)
}

function sameOrder(listed: readonly string[], files: readonly ProjectFile[]): boolean {
  return listed.length === files.length && listed.every((id, i) => id === files[i].pageId)
}
function joinPath(...parts: string[]): string {
  
  return parts.filter(Boolean).join('/')
}


export const useProjectStore = defineStore('project', () => {
  const rootPath = ref<string | null>(null)
  const projectMeta = ref<ProjectJson>(defaultProjectJson())
  /**
   * Every page the chapter has, in reading order, including the ones marked
   * deleted. What goes to disk as `pages`, and the only thing that knows where
   * a deleted page belongs — which is why it keeps them: undo puts a page back
   * in its own place rather than at the end.
   */
  const allFiles = ref<ProjectFile[]>([])
  const metaDirty = ref(false)
  
  const dirtyPageIds = ref<string[]>([])

  const isOpen = computed(() => rootPath.value !== null)
  const folderPath = computed(() => rootPath.value)

  /**
   * Whether `path` names the book this store already holds open.
   *
   * The one door a second writer has to check before touching a book's
   * `project.json`: this store's autosave is the only writer for the book it
   * holds, and a lightweight session working on a book from the library has
   * to back off rather than race it the moment the two name the same book.
   */
  function isOpenRoot(path: string): boolean {
    return rootPath.value === path
  }
  const header = computed<ProjectHeader>(() => ({
    tags: projectMeta.value.tags,
    seedStyle: projectMeta.value.seedStyle,
    comment: projectMeta.value.comment,
  }))
  const dirty = computed(() => metaDirty.value || dirtyPageIds.value.length > 0)

  const deletedPageIds = computed(() => new Set(projectMeta.value.deletedPages ?? []))

  /**
   * The pages of the chapter, meaning the ones still in it. Everything that
   * shows, turns, exports or counts pages reads this, so a page that has been
   * deleted leaves all of them at once.
   */
  const files = computed(() => allFiles.value.filter((f) => !deletedPageIds.value.has(f.pageId)))

  const shashokuDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR),
  )

  /**
   * Deliberately reaches the deleted ones too. What holds a page id holds it
   * across a delete — the save queue, an undo waiting further down the stack —
   * and a page that answers nothing while its work is still owed to disk would
   * lose that work.
   */
  function pageById(pageId: string): ProjectFile | undefined {
    return allFiles.value.find((f) => f.pageId === pageId)
  }

  /**
   * Deliberately not rescheduled after a failure: a disk that is gone stays
   * gone, and retrying on a timer would turn one broken write into a loop. The
   * work stays queued for the next edit or the next flush.
   */
  const autosave = createAutosave(save, {
    onError: (err) => console.error('autosave failed', err),
  })

  /**
   * Everything that owes bytes to `layers/` before a reader of that folder can
   * be trusted.
   *
   * Pixels are written on a scheduler of their own and much more slowly than the
   * manifest, so at any moment the newest paint may only be in memory. Anything
   * that reads the folder — exporting, making a thumbnail, closing the project —
   * has to make it true first, and that is not a flaw in deferred writing, it is
   * what deferred writing means.
   *
   * A register rather than a call from each of them, so that a consumer added
   * later inherits the obligation instead of having to be told about it.
   */
  const layerObligations = new Set<() => Promise<void>>()

  function oweBeforeLayerRead(settle: () => Promise<void>): void {
    layerObligations.add(settle)
  }

  /** The manifest alone. What a pixel flush calls once it has named its file. */
  function flushManifest(): Promise<void> {
    return autosave.flush()
  }

  /**
   * Everything down: the pixels first, because settling them is what gives the
   * manifest its final names, and the manifest after.
   */
  async function flush(): Promise<void> {
    for (const settle of layerObligations) await settle()
    await autosave.flush()
  }

  /**
   * Every mutation below ends here or in markMetaDirty, which is what lets the
   * autosave be scheduled in two places rather than at each of the twenty-odd
   * call sites — and what keeps a new mutation from silently opting out of it.
   */
  function markPageDirty(pageId: string) {
    if (!dirtyPageIds.value.includes(pageId)) dirtyPageIds.value.push(pageId)
    autosave.mark()
  }

  function markMetaDirty() {
    metaDirty.value = true
    autosave.mark()
  }

  const faces = computed<TranslationFace[]>(() => projectMeta.value.faces ?? [])
  const faceIds = computed(() => faces.value.map((f) => f.id))

  /** The face the interface works on; the first one when the project names none it has. */
  const activeFace = computed(() => {
    const id = projectMeta.value.activeFace
    return id !== undefined && faces.value.some((f) => f.id === id) ? id : (faces.value[0]?.id ?? '')
  })

  /** A page as one face reads it — the face being worked on, unless another is named. */
  function viewOf(pageId: string, face: string = activeFace.value): FacePage | undefined {
    const file = pageById(pageId)
    return file ? facePage(file.page, face) : undefined
  }

  function setActiveFace(id: string): void {
    if (!faceIds.value.includes(id) || projectMeta.value.activeFace === id) return
    projectMeta.value.activeFace = id
    markMetaDirty()
  }

  function renameFace(id: string, name: string): void {
    const face = faces.value.find((f) => f.id === id)
    if (!face || face.name === name) return
    face.name = name
    markMetaDirty()
  }

  /**
   * A new face, lettered on every page the way the one being worked on is —
   * every page, deleted ones included, since a page brought back has to read in
   * every face the book has.
   */
  function addFace(name: string): string {
    const id = generateId()
    const from = activeFace.value
    for (const file of allFiles.value) {
      copyFace(file.page, from, id, generateId)
      markPageDirty(file.pageId)
    }
    const no = projectMeta.value.nextFace ?? Math.max(0, ...faces.value.map((f) => f.no)) + 1
    projectMeta.value.faces = [...faces.value, { id, no, name }]
    projectMeta.value.nextFace = no + 1
    markMetaDirty()
    return id
  }

  /** Refused for the last face: a book has to be lettered in something. */
  function deleteFace(id: string): boolean {
    if (faces.value.length <= 1 || !faceIds.value.includes(id)) return false
    for (const file of allFiles.value) {
      dropFace(file.page, id)
      markPageDirty(file.pageId)
    }
    projectMeta.value.faces = faces.value.filter((f) => f.id !== id)
    if (projectMeta.value.activeFace === id) projectMeta.value.activeFace = projectMeta.value.faces[0]!.id
    markMetaDirty()
    return true
  }

  /**
   * Every page's structure and the face list, written back whole — what undoing
   * an added or deleted face puts back.
   */
  function setFaceState(state: FaceState): void {
    for (const [pageId, structure] of Object.entries(state.pages)) setPageStructure(pageId, structure)
    projectMeta.value.faces = structuredClone(state.faces)
    projectMeta.value.activeFace = state.activeFace
    markMetaDirty()
  }

  function faceState(): FaceState {
    const pages: Record<string, PageStructure> = {}
    for (const file of allFiles.value) pages[file.pageId] = structureOf(file.pageId)!
    return { pages, faces: faces.value.map((f) => ({ ...f })), activeFace: activeFace.value }
  }

  function structureOf(pageId: string): PageStructure | undefined {
    const file = pageById(pageId)
    if (!file) return undefined
    // A JSON round trip rather than structuredClone: arrays written back
    // through the reactive page hold proxies as elements, which it refuses.
    const { ledgers, readingOrder, readingEdges } = file.page
    return { ...JSON.parse(JSON.stringify({ ledgers, readingOrder, readingEdges })), ...snapshotTrees(file.page) }
  }

  function removeBlock(page: ManifestJson, id: string): void {
    removeFromPage(page, id)
  }

  /** The tree an edit lands in: a face's, or the page's own (`null`), which is what the source side shows. */
  function homeTree(page: ManifestJson, home: string | null): LayerEntry[] {
    return home === null ? page.pageTree : ownTree(page, home)
  }

  /**
   * What taking blocks off a page means for every face, worked out after they
   * are gone.
   *
   * A sentence left without any of the artwork's words is gone, lettering and
   * all. One left without lettering is gone too, words and all, when this face
   * is the only one — deleting a row has always taken both. With other faces
   * the artwork's words are still theirs, so the sentence stays and gets a
   * blank block of lettering instead, standing on them.
   */
  function settleStructure(page: ManifestJson): void {
    const ids = faceIds.value
    for (let changed = true; changed; ) {
      changed = false
      const present = new Map(everyText(page).map((t) => [t.id, t]))
      for (const face of ids) {
        const view = facePage(page, face)
        for (const unit of view.units) unit.members = unit.members.filter((id) => present.has(id))
        for (const unit of [...view.units]) {
          const sources = unit.members.filter((id) => present.get(id)?.side === 'source')
          const lettering = unit.members.filter((id) => present.get(id)?.side === 'translation')
          if (sources.length > 0 && lettering.length > 0) continue
          if (sources.length > 0 && ids.length > 1) {
            const near = present.get(sources[0]!)!
            const blank = blankTranslationBlock(generateId(), face, near.body.style)
            blank.body.x = near.body.x
            blank.body.y = near.body.y
            addFaceEntry(page, face, blank)
            unit.members.push(blank.id)
            continue
          }
          for (const id of unit.members) removeBlock(page, id)
          changed ||= unit.members.length > 0
          view.units = view.units.filter((u) => u !== unit)
        }
      }
    }
    const words = new Set(textObjects(page.pageTree).flatMap((b) => (b.side === 'source' ? [b.id] : [])))
    page.readingOrder = page.readingOrder.filter((id) => words.has(id))
    page.readingEdges = page.readingEdges.filter((e) => words.has(e.from) && words.has(e.to))
    adoptSources(page, ids, generateId, projectMeta.value.seedStyle)
    numberPage(page, ids)
  }

  /**
   * Counters worked out on a copy of the page, taken over where they are ahead.
   * Only ever forward: undo writes structure back, never counters.
   */
  function raiseCounters(pageId: string, counters: NumberCounters): void {
    const file = pageById(pageId)
    if (!file) return
    const live = file.page.counters
    live.source = Math.max(live.source, counters.source)
    for (const key of ['units', 'blocks', 'candidates'] as const) {
      for (const id of Object.keys(counters[key])) carryCounter(counters[key], live[key], id)
    }
    markPageDirty(pageId)
  }

  /** Numbers what a step left without one; see `numberPage`. */
  function renumber(pageId: string): void {
    const file = pageById(pageId)
    if (file) numberPage(file.page, faceIds.value)
  }

  function reset() {
    autosave.cancel()
    rootPath.value = null
    projectMeta.value = defaultProjectJson()
    allFiles.value = []
    metaDirty.value = false
    dirtyPageIds.value = []
  }


  async function ingestProject(
    newRootPath: string,
    projectMetaRaw: string,
    pages: readonly PageEntry[],
  ): Promise<void> {
    // The only place the open project is replaced, so the only place the
    // outgoing one has to be banked. Still addressed by the old rootPath here,
    // which is what makes it land where it came from.
    await flush()
    const meta = parseProjectJson(projectMetaRaw)
    // A book from before faces gets its one face now: every page names it, so
    // it has to exist before the first page is read.
    const seeded = meta.faces === undefined
    if (meta.faces === undefined) {
      const id = generateId()
      meta.faces = [{ id, no: 1, name: '譯文' }]
      meta.nextFace = 2
      meta.activeFace = id
    }
    const ids = meta.faces.map((f) => f.id)
    const loaded: ProjectFile[] = []
    // A page whose structure had drifted, or that was written before faces, is
    // put right here and queued to be written back, so the fix is made once
    // rather than recomputed every open.
    const mended: string[] = []
    for (const p of pages) {
      let page = unreadablePage(p.pageId)
      let ocr = defaultOcr(page.width, page.height)
      try {
        const raw = await window.api.readPage(p.pageDir)
        const repair = repairPage(parseManifest(raw.manifestRaw, ids[0]!), ids)
        page = repair.manifest
        if (repair.repaired.length > 0 || isOlderManifest(raw.manifestRaw)) mended.push(p.pageId)
        // Readings fail on their own: a page whose ocr.json is unreadable is
        // still a page someone can typeset.
        ocr = raw.ocrRaw === null ? defaultOcr(page.width, page.height) : parseOcr(raw.ocrRaw)
      } catch {
        // Opens empty rather than taking the whole project down. The page
        // already carries a badge saying its manifest could not be read.
      }
      withEveryLedger(page, ids)
      loaded.push({ pageId: p.pageId, pageDir: p.pageDir, page, ocr, badge: p.badge })
    }
    rootPath.value = newRootPath
    projectMeta.value = meta
    allFiles.value = loaded
    metaDirty.value = false
    dirtyPageIds.value = []
    for (const pageId of mended) markPageDirty(pageId)
    // The open reconciled the list against the directories on disk. Writing
    // that back now is what keeps a page nobody listed from being taken in
    // again at every open for the rest of the project's life.
    if (!sameOrder(meta.pages, loaded) || seeded) markMetaDirty()
    if (meta.pinnedLayerNames === undefined) {
      meta.pinnedLayerNames = [...usePreferencesStore().prefs.pinnedLayerSeed]
      markMetaDirty()
    }
    if (meta.exportMenu === undefined) {
      meta.exportMenu = usePreferencesStore().prefs.exportMenuSeed.map((profile) => ({
        id: generateId(),
        profile: JSON.parse(JSON.stringify(profile)) as ExportProfile,
        exportedAt: null,
      }))
      markMetaDirty()
    }
    // Opening a project is also how its neighbours get found: the folder it
    // sits in becomes somewhere the library looks from now on.
    usePreferencesStore().addScanPoint(parentFolder(newRootPath))
  }

  /**
   * Reading a project back off disk, with the queued writes banked first.
   *
   * The order is the whole point and must not be taken apart: `openProject`
   * sweeps every layer file the manifest on disk does not name, and both halves
   * of a page are written on schedulers of their own. Sweeping ahead of the
   * flush therefore deletes work that was never saved, and then writes a
   * manifest pointing at the file it just removed.
   */
  async function reopen(rootPathToOpen: string): Promise<void> {
    await flush()
    const result = await window.api.openProject(rootPathToOpen)
    await ingestProject(rootPathToOpen, result.projectMetaRaw, result.pages)
  }


  async function createNewProject(): Promise<string | null> {
    const picked = await window.api.pickRoot()
    if (picked === null) return null
    const scan = await window.api.scanRoot(picked)
    if (scan.hasShashokuDir) {
      throw new Error(`此資料夾已含 ${SHASHOKU_DIR}/,請改用「開啟」`)
    }
    const result = await window.api.createProject(picked)
    await ingestProject(picked, result.projectMetaRaw, result.pages)
    return picked
  }

  
  async function openExisting(): Promise<string | null> {
    const picked = await window.api.pickRoot()
    if (picked === null) return null
    const scan = await window.api.scanRoot(picked)
    if (!scan.hasShashokuDir || !scan.hasSentinel) {
      throw new Error(`此資料夾不是 Shashoku 專案(缺 ${SHASHOKU_DIR}/ 或 sentinel)`)
    }
    await reopen(picked)
    return picked
  }


  /**
   * Moves a page to sit in front of another, or to the end when given nothing.
   *
   * Anchored to a neighbour rather than to an index because an index is only
   * true of the list it was read from — the same drop replayed against a list
   * that has since gained or lost pages lands somewhere else. A neighbour that
   * has since gone lands the page at the end, which is wrong in a way anybody
   * can see.
   */
  function movePageBefore(pageId: string, beforeId: string | null): void {
    const from = allFiles.value.findIndex((f) => f.pageId === pageId)
    if (from === -1) return
    const [moved] = allFiles.value.splice(from, 1)
    const at = beforeId === null ? -1 : allFiles.value.findIndex((f) => f.pageId === beforeId)
    allFiles.value.splice(at === -1 ? allFiles.value.length : at, 0, moved)
    markMetaDirty()
  }

  /**
   * Marks pages deleted, and answers with the ones it really marked.
   *
   * Answering matters because the caller is putting this on the undo stack: a
   * page already marked, or one no longer in the chapter at all, is not
   * something an undo may un-mark. What comes back is what happened.
   *
   * Nothing here touches the disk, so nothing here can fail or take time — a
   * chapter's worth of pages goes in one synchronous step.
   */
  function tagPagesDeleted(pageIds: readonly string[]): string[] {
    const marked = deletedPageIds.value
    const present = new Set(allFiles.value.map((f) => f.pageId))
    const tagged = [...new Set(pageIds)].filter((id) => present.has(id) && !marked.has(id))
    if (tagged.length === 0) return []
    projectMeta.value.deletedPages = [...(projectMeta.value.deletedPages ?? []), ...tagged]
    markMetaDirty()
    return tagged
  }

  /**
   * Every page named in `order`, taken from `pool` — `allFiles` for a plain
   * reorder, `allFiles` plus whatever just arrived for an import. `null`
   * rather than a best effort when `order` and `pool` do not name exactly the
   * same pages: a reorder command's `before`/`after` are evidence about the
   * chapter as it stood at the drag, and a chapter that has since gained or
   * lost a page makes both stale rather than partially right.
   */
  function orderedByIds(order: readonly string[], pool: readonly ProjectFile[]): ProjectFile[] | null {
    const byId = new Map(pool.map((f) => [f.pageId, f]))
    if (byId.size !== order.length || byId.size !== pool.length) return null
    const out: ProjectFile[] = []
    for (const id of order) {
      const file = byId.get(id)
      if (!file) return null
      out.push(file)
    }
    return out
  }

  /**
   * Puts the chapter back into the order `snapshot` remembers — the `do`/
   * `undo` of a drag that reordered pages, each holding a complete `string[]`
   * rather than a delta so neither has to depend on where the selection or the
   * drop point stood by the time it runs again.
   *
   * ⛔ Only the pages the snapshot covers move. A page imported after the drag
   * and since undone still has its name in the chapter, and a snapshot taken
   * before it existed says nothing about where it goes; `applyPageOrderSnapshot`
   * is what holds it in its own slot rather than letting this decide.
   */
  function applyOrderSnapshot(snapshot: readonly string[]): boolean {
    const ids = applyPageOrderSnapshot(
      allFiles.value.map((f) => f.pageId),
      [...deletedPageIds.value],
      snapshot,
    )
    if (ids === null) return false
    const byId = new Map(allFiles.value.map((f) => [f.pageId, f]))
    allFiles.value = ids.map((id) => byId.get(id) as ProjectFile)
    markMetaDirty()
    return true
  }

  /**
   * Pages made from files dropped on the shelf join the chapter and land in
   * `order` in the same step — an import's undo only ever tombstones them
   * afterwards, so this is the one chance to put them where the drop asked.
   */
  function insertPages(entries: readonly ProjectFile[], order: readonly string[]): boolean {
    const have = new Set(allFiles.value.map((f) => f.pageId))
    const pool = [...allFiles.value, ...entries.filter((f) => !have.has(f.pageId))]
    const next = orderedByIds(order, pool)
    if (next === null) return false
    allFiles.value = next
    markMetaDirty()
    return true
  }

  /**
   * One page read fresh off disk, the same way `ingestProject` reads every
   * page at open — for a page the shelf just made while this book is the one
   * open in the editor, so it can join `allFiles` without a full reopen.
   */
  async function loadFreshPage(pageId: string, pageDir: string): Promise<ProjectFile> {
    let page: ManifestJson
    let ocr: OcrJson
    let badge: ProjectFile['badge'] = 'ok'
    try {
      const raw = await window.api.readPage(pageDir)
      page = repairPage(parseManifest(raw.manifestRaw, faceIds.value[0]!), faceIds.value).manifest
      ocr = raw.ocrRaw === null ? defaultOcr(page.width, page.height) : parseOcr(raw.ocrRaw)
    } catch {
      page = unreadablePage(pageId)
      ocr = defaultOcr(page.width, page.height)
      badge = 'damaged'
    }
    withEveryLedger(page, faceIds.value)
    return { pageId, pageDir, page, ocr, badge }
  }

  /** Peels the mark off, which puts each page back where it never stopped being. */
  function untagPagesDeleted(pageIds: readonly string[]): void {
    const marked = projectMeta.value.deletedPages ?? []
    const taking = new Set(pageIds)
    const kept = marked.filter((id) => !taking.has(id))
    if (kept.length === marked.length) return
    projectMeta.value.deletedPages = kept
    markMetaDirty()
  }

  
  async function openByPath(rootPathToOpen: string): Promise<string | null> {
    const scan = await window.api.scanRoot(rootPathToOpen)
    if (!scan.hasShashokuDir || !scan.hasSentinel) return null
    await reopen(rootPathToOpen)
    return rootPathToOpen
  }

  /**
   * The flags are taken and cleared before the first await, so an edit made
   * while the write is out marks the page again and earns the next write
   * instead of being cleared along with the one that predated it. A failure
   * puts them back, which both keeps the data queued and lights the title's
   * unsaved marker — under autosave that marker means "not on disk", and this
   * is the only way it stays on.
   */
  async function save(): Promise<void> {
    const root = rootPath.value
    if (root === null || !dirty.value) return

    const pages = dirtyPageIds.value
    const metaWasDirty = metaDirty.value
    dirtyPageIds.value = []
    metaDirty.value = false

    try {
      for (const pageId of pages) {
        const file = pageById(pageId)
        // A page that could not be read opened as a blank stand-in. Writing
        // that back would replace a file that may still be recoverable.
        if (!file || file.badge !== 'ok') continue
        await window.api.writePage(file.pageDir, {
          manifestRaw: serializeManifest(file.page),
          // On the same trip as the manifest: a text object names a reading,
          // and the name must not outlive what it names.
          ocrRaw: serializeOcr(file.ocr),
        })
      }
      if (metaWasDirty) {
        // The order is taken from the pages themselves rather than kept in step
        // with them: two places holding it is two places for it to be wrong.
        await window.api.writeProjectMeta(
          shashokuDirOf(root),
          serializeProjectJson({
            ...projectMeta.value,
            pages: allFiles.value.map((f) => f.pageId),
          }),
        )
      }
    } catch (err) {
      for (const pageId of pages) {
        if (!dirtyPageIds.value.includes(pageId)) dirtyPageIds.value.push(pageId)
      }
      if (metaWasDirty) metaDirty.value = true
      throw err
    }
  }



  /** Which page holds a sentence of the face being worked on, or null where none does. */
  function pageOfUnit(unitId: string): string | null {
    for (const file of files.value) {
      if (facePage(file.page, activeFace.value).units.some((u) => u.id === unitId)) return file.pageId
    }
    return null
  }

  /** A page's sentences as a reader of the face being worked on meets them — the label list's order. */
  function labelsOf(pageId: string): TranslationUnit[] {
    const view = viewOf(pageId)
    return view ? unitsInReadingOrder(view) : []
  }

  function unitById(pageId: string, unitId: string, face: string = activeFace.value): TranslationUnit | undefined {
    const view = viewOf(pageId, face)
    return view ? findUnit(view, unitId) : undefined
  }

  function blockById(pageId: string, blockId: string): TextLayerEntry | undefined {
    const file = pageById(pageId)
    return file ? textOnPage(file.page, blockId) : undefined
  }

  /** What the sentence a block belongs to in the face being worked on means. */
  function tagsOf(pageId: string, blockId: string): string[] {
    const view = viewOf(pageId)
    return view ? tagsOfBlock(view, blockId) : []
  }

  /** Which sentence of the face being worked on a block belongs to. */
  function placeOf(pageId: string, blockId: string): UnitPlace | undefined {
    const view = viewOf(pageId)
    return view ? placeOfBlock(view, blockId) : undefined
  }

  /**
   * A new sentence, on top of the tree and at the end of every face's reading:
   * the end of the tree because that is what new lettering stacks on top of,
   * and the end of the reading because inserting near the pointer would
   * renumber the page under whoever is reading it.
   *
   * The units and their blocks arrive together, so no moment exists where a
   * block is on the page with nothing saying what it is.
   */
  function addLabel(pageId: string, label: TranslationParts) {
    const file = pageById(pageId)
    if (!file) return
    for (const block of label.blocks) {
      if (block.side === 'source') addPageEntry(file.page, block)
      else addFaceEntry(file.page, block.face, block)
    }
    file.page.readingOrder.push(...label.blocks.flatMap((b) => (b.side === 'source' ? [b.id] : [])))
    for (const [face, unit] of Object.entries(label.units)) facePage(file.page, face).units.push(unit)
    settleStructure(file.page)
    markPageDirty(pageId)
  }

  /**
   * A sentence of the face being worked on, read right after another one — or
   * last, when that one is not on the page. Its blocks are already there.
   */
  function insertUnit(pageId: string, unit: TranslationUnit, after?: string) {
    const file = pageById(pageId)
    if (!file) return
    const view = facePage(file.page, activeFace.value)
    view.units.push(unit)
    const behind = after === undefined ? undefined : view.units.find((u) => u.id === after)
    if (behind) readAfter(file.page, unit.members, behind.members)
    settleStructure(file.page)
    markPageDirty(pageId)
  }

  /**
   * A whole sentence of the face being worked on off the page: its artwork's
   * words and its lettering, its place in the reading and every line touching
   * it. The artwork's words leave every other face too, and a sentence there
   * left with none of them goes with them.
   */
  function deleteLabel(pageId: string, unitId: string): PageSnapshot | null {
    const file = pageById(pageId)
    const unit = unitById(pageId, unitId)
    if (!file || !unit) return null
    const before = structureOf(pageId)!
    for (const id of unit.members) removeBlock(file.page, id)
    settleStructure(file.page)
    markPageDirty(pageId)
    return { pageId, before }
  }

  /**
   * Sentences of the face being worked on carried to another page together,
   * onto the end of its tree and every reading. Their artwork's words are every
   * face's, so every sentence that shares one of them goes too, and every block
   * those hold — a page left with half the lettering of the words that moved
   * away is a page nobody can work on. Lines between two travellers travel; the
   * rest stay, which is why the whole batch has to move in one call.
   */
  function moveSentences(fromId: string, toId: string, unitIds: readonly string[]): boolean {
    const from = pageById(fromId)
    const to = pageById(toId)
    const starts = unitIds.flatMap((id) => unitById(fromId, id) ?? [])
    if (!from || !to || starts.length === 0 || fromId === toId) return false
    const blocks = new Set(starts.flatMap((u) => u.members))
    const moving = new Map<string, Set<string>>()
    for (let grew = true; grew; ) {
      grew = false
      for (const face of faceIds.value) {
        for (const unit of facePage(from.page, face).units) {
          if (!unit.members.some((id) => blocks.has(id))) continue
          const units = moving.get(face) ?? new Set<string>()
          moving.set(face, units)
          if (!units.has(unit.id)) {
            units.add(unit.id)
            grew = true
          }
          for (const id of unit.members) blocks.add(id)
        }
      }
    }
    for (const id of blocks) {
      const entry = removeFromPage(from.page, id)
      if (entry === null || entry.kind !== 'text') continue
      // Numbered by the page it left; the page it joins numbers it again. What
      // it numbers inside itself travels with it.
      if (entry.side === 'source') {
        delete entry.no
        addPageEntry(to.page, entry)
      } else addFaceEntry(to.page, entry.face, entry)
      carryCounter(from.page.counters.candidates, to.page.counters.candidates, id)
    }
    for (const [face, units] of moving) {
      const src = facePage(from.page, face)
      const dst = facePage(to.page, face)
      for (const u of src.units) {
        if (!units.has(u.id)) continue
        delete u.no
        carryCounter(from.page.counters.blocks, to.page.counters.blocks, u.id)
      }
      dst.units.push(...src.units.filter((u) => units.has(u.id)))
      src.units = src.units.filter((u) => !units.has(u.id))
    }
    // The words read in the order they read where they were, after what the
    // page they join already reads. A line between two of them travels; one
    // with an end left behind stays, and the settle below drops it.
    to.page.readingOrder = [...sourceOrder(to.page), ...sourceOrder(from.page).filter((id) => blocks.has(id))]
    to.page.readingEdges = normalizeEdges([
      ...to.page.readingEdges,
      ...from.page.readingEdges.filter((e) => blocks.has(e.from) && blocks.has(e.to)),
    ])
    settleStructure(from.page)
    settleStructure(to.page)
    markPageDirty(fromId)
    markPageDirty(toId)
    return true
  }

  /**
   * Any entry, not only a text object: hiding a folder is how a whole run of
   * them goes away at once.
   */
  function setLayerVisible(pageId: string, layerId: string, visible: boolean) {
    const file = pageById(pageId)
    if (!file) return
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.visible === visible) return
    entry.visible = visible
    markPageDirty(pageId)
  }

  /**
   * A folder or a raster only.
   *
   * A text object has no name to change: the tree and the label list are two
   * views of the same object, and a name anyone could edit would let one object
   * read differently in each. A raster is the opposite case — its content is
   * pixels, which read as nothing, so 「塗白」 carries real information.
   */
  function renameLayer(pageId: string, layerId: string, name: string): boolean {
    const file = pageById(pageId)
    if (!file) return false
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.kind === 'text' || entry.name === name) return false
    entry.name = name
    markPageDirty(pageId)
    return true
  }

  /**
   * Where a raster layer's pixels sit and which file they are in.
   *
   * The frame is rounded here rather than trusted from the caller because the
   * manifest refuses a fractional one outright, and every mutation reaches the
   * autosave — one fractional write mid-gesture would leave a project that no
   * longer opens.
   */
  function placeLayer(
    pageId: string,
    layerId: string,
    at: { file: string; x: number; y: number; w: number; h: number },
  ) {
    const file = pageById(pageId)
    if (!file) return
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.kind !== 'raster') return
    entry.file = at.file
    entry.x = Math.round(at.x)
    entry.y = Math.round(at.y)
    entry.w = Math.round(at.w)
    entry.h = Math.round(at.h)
    markPageDirty(pageId)
  }

  function setLayerLocked(pageId: string, layerId: string, locked: boolean) {
    const file = pageById(pageId)
    if (!file) return
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.locked === locked) return
    entry.locked = locked
    markPageDirty(pageId)
  }

  /**
   * A raster only, and refused rather than corrected elsewhere. It is a rule
   * about where paint may land on this layer's own pixels, and an entry that
   * holds none has nothing for the rule to be about — a folder's contents each
   * answer for themselves.
   */
  function setLayerAlphaLocked(pageId: string, layerId: string, alphaLocked: boolean): boolean {
    const file = pageById(pageId)
    if (!file) return false
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.kind !== 'raster' || entry.alphaLocked === alphaLocked) return false
    entry.alphaLocked = alphaLocked
    markPageDirty(pageId)
    return true
  }

  /** Any entry too — a folder carries blending so a run can be faded as one. */
  function setLayerOpacity(pageId: string, layerId: string, opacity: number) {
    const file = pageById(pageId)
    if (!file) return
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.opacity === opacity) return
    entry.opacity = opacity
    markPageDirty(pageId)
  }

  /**
   * Refused rather than corrected for a mode the entry cannot mean:
   * pass-through says "no buffer of my own", and only a container has one to
   * decline. Letting it through would write a manifest that will not parse.
   */
  function setLayerBlendMode(pageId: string, layerId: string, blendMode: string): boolean {
    const file = pageById(pageId)
    if (!file) return false
    const entry = entryOnPage(file.page, layerId)
    if (!entry || entry.blendMode === blendMode) return false
    if (blendMode === PASS_THROUGH && entry.kind !== 'group') return false
    entry.blendMode = blendMode
    markPageDirty(pageId)
    return true
  }

  /**
   * A layer joins the page on top, which is where anything new belongs; a path
   * is how undo puts one back exactly where it was. A folder arrives empty and
   * is filed into afterwards.
   *
   * Unlike `addLabel` this touches no reading order — a folder and a raster are
   * not things a reader meets.
   */
  function addLayer(pageId: string, home: string | null, entry: LayerEntry, path?: number[]) {
    const file = pageById(pageId)
    if (!file) return
    // Words go where words belong whatever tree the edit is in: the artwork's to
    // the page, lettering to its face. A path read in another tree means nothing there.
    const at = entry.kind !== 'text' ? home : entry.side === 'source' ? null : entry.face
    const where = at === home ? path : undefined
    if (at === null) addPageEntry(file.page, entry, where)
    else addFaceEntry(file.page, at, entry, where)
    markPageDirty(pageId)
  }

  /** See `linkToPage` and `unlinkToFace`; answers whether the layer changed hands. */
  function setLayerLinked(pageId: string, face: string, layerId: string, linked: boolean): boolean {
    const file = pageById(pageId)
    if (!file) return false
    const done = linked ? linkToPage(file.page, face, layerId) : unlinkToFace(file.page, face, layerId)
    if (done) markPageDirty(pageId)
    return done
  }

  /** Whether a layer is the page's, which every face shares. */
  function isLinked(pageId: string, layerId: string): boolean {
    const file = pageById(pageId)
    return file ? isPageEntry(file.page, layerId) : false
  }

  function dissolveFolder(
    pageId: string,
    folderId: string,
  ): { home: string; path: number[]; folder: GroupLayerEntry } | null {
    const file = pageById(pageId)
    if (!file) return null
    const home = homeOf(file.page, folderId)
    if (home === null || home === undefined) return null
    const tree = homeTree(file.page, home)
    const path = pathOf(tree, folderId)
    if (path === null) return null
    const folder = dissolveGroupAt(tree, path)
    if (folder === null) return null
    markPageDirty(pageId)
    return { home, path, folder }
  }

  function restoreFolder(pageId: string, home: string, path: number[], folder: GroupLayerEntry) {
    const file = pageById(pageId)
    if (!file) return
    if (!restoreGroupAt(homeTree(file.page, home), path, folder)) return
    markPageDirty(pageId)
  }

  /**
   * Everything that says which blocks make which sentence, written back whole:
   * every face's ledger and the tree. For a step whose before and after are both
   * whole pages of that structure — which is how anything that adds, removes or
   * regroups blocks is undone.
   *
   * ⚠️ A raster still on the page keeps the entry it has now. Pixels settle into
   * a new file outside any step, so the snapshot's entry can name a file that
   * has since been replaced.
   */
  function setPageStructure(pageId: string, structure: PageStructure) {
    const file = pageById(pageId)
    if (!file) return
    const copy = JSON.parse(JSON.stringify(structure)) as PageStructure
    file.page.readingOrder = copy.readingOrder
    file.page.readingEdges = copy.readingEdges
    const live = new Map(
      everyEntry(file.page)
        .filter((e) => e.kind === 'raster')
        .map((e) => [e.id, e]),
    )
    const graft = (entries: LayerEntry[]): LayerEntry[] =>
      entries.map((e) => {
        if (e.kind === 'group') return { ...e, children: graft(e.children) }
        if (e.kind === 'raster') return live.get(e.id) ?? e
        return e
      })
    file.page.ledgers = copy.ledgers
    // The page's first, so every face tree's reference resolves to the one live object.
    const pageTree = graft(copy.pageTree)
    file.page.pageTree = pageTree
    file.page.faceTrees = Object.fromEntries(
      Object.entries(resolveTrees(pageTree, copy.faceTrees)).map(([face, tree]) => [face, graft(tree)]),
    )
    markPageDirty(pageId)
  }

  /**
   * The sentences of the face being worked on, put in this order — written onto
   * the artwork's words, so every face reads the page in the new order too.
   */
  function setReadingOrder(pageId: string, order: readonly string[]) {
    const view = viewOf(pageId)
    if (!view) return
    view.manifest.readingOrder = sourceOrderFor(view.manifest, view.units, order)
    markPageDirty(pageId)
  }

  function readingEdgesOf(pageId: string, face: string = activeFace.value): readonly ReadingEdge[] {
    return viewOf(pageId, face)?.readingEdges ?? []
  }

  /**
   * Draws lines between sentences of the face being worked on and answers with
   * the lines of the artwork they became, which is what undo has to rub out — a
   * gesture that repeats a line already there must not take it away when it is
   * taken back.
   *
   * Judged one at a time against what is held so far, in this face and on the
   * artwork, so a gesture cannot close a ring against its own earlier link
   * either. The canvas asks the same question while the pointer is still down,
   * so reaching this refusal means something got past that.
   */
  function addReadingEdges(pageId: string, edges: readonly ReadingEdge[]): ReadingEdge[] {
    const view = viewOf(pageId)
    if (!view) return []
    const taken: ReadingEdge[] = []
    for (const edge of edges) {
      const held = view.readingEdges
      if (hasEdge(held, edge) || wouldCycle(held, edge)) continue
      const lifted = sourceEdgeFor(view.manifest, view.units, edge)
      if (lifted === null || hasEdge(view.manifest.readingEdges, lifted) || wouldCycle(view.manifest.readingEdges, lifted))
        continue
      view.manifest.readingEdges = normalizeEdges([...view.manifest.readingEdges, lifted])
      taken.push(lifted)
    }
    if (taken.length > 0) markPageDirty(pageId)
    return taken
  }

  /** Rubs out lines between sentences of the face being worked on, answering with the artwork's lines it took. */
  function removeReadingEdges(pageId: string, edges: readonly ReadingEdge[]): ReadingEdge[] {
    const view = viewOf(pageId)
    if (!view || edges.length === 0) return []
    const going = edges.flatMap((e) => sourceEdgesUnder(view.manifest, view.units, e))
    removeSourceEdges(pageId, going)
    return going
  }

  /** Lines of the artwork put back exactly — what undo of a rub-out, or redo of a draw, writes. */
  function addSourceEdges(pageId: string, edges: readonly ReadingEdge[]): void {
    const file = pageById(pageId)
    if (!file || edges.length === 0) return
    file.page.readingEdges = normalizeEdges([...file.page.readingEdges, ...edges])
    markPageDirty(pageId)
  }

  function removeSourceEdges(pageId: string, edges: readonly ReadingEdge[]): void {
    const file = pageById(pageId)
    if (!file || edges.length === 0) return
    const left = withoutEdges(file.page.readingEdges, edges)
    if (left.length === file.page.readingEdges.length) return
    file.page.readingEdges = left
    markPageDirty(pageId)
  }

  /** On top of everything, which is where an object arriving on a page belongs. */
  function appendEntry(pageId: string, home: string | null, entry: LayerEntry) {
    addLayer(pageId, home, entry)
  }

  /** Which page an entry is on, since the selection reaches across all of them. */
  function pageOfEntry(id: string): string | null {
    for (const file of files.value) {
      if (entryOnPage(file.page, id)) return file.pageId
    }
    return null
  }

  /** Anything on any page of the chapter — the selection reaches across them. */
  function entryById(id: string): LayerEntry | undefined {
    for (const file of files.value) {
      const found = entryOnPage(file.page, id)
      if (found) return found
    }
    return undefined
  }

  /** Any entry, folders taking what they hold; every face's sentences settle around what went. */
  function removeEntry(id: string): PageSnapshot | null {
    for (const file of files.value) {
      if (homeOf(file.page, id) === undefined) continue
      const before = structureOf(file.pageId)!
      removeFromPage(file.page, id)
      settleStructure(file.page)
      markPageDirty(file.pageId)
      return { pageId: file.pageId, before }
    }
    return null
  }

  /** Undoes one removal — or any step recorded the same way. */
  function restoreEntry(removed: PageSnapshot): void {
    setPageStructure(removed.pageId, removed.before)
  }

  function moveLayer(pageId: string, home: string | null, fromPath: number[], target: DropTarget): boolean {
    const file = pageById(pageId)
    if (!file) return false
    if (!moveEntry(homeTree(file.page, home), fromPath, target)) return false
    markPageDirty(pageId)
    return true
  }

  /**
   * Undoes a restack by putting an entry back at the path it left, which the
   * drop rules cannot express: their indices are read before the entry comes
   * out, and running them backwards lands one place off.
   */
  function restoreLayerAt(pageId: string, home: string | null, layerId: string, path: number[]) {
    const file = pageById(pageId)
    if (!file) return
    const tree = homeTree(file.page, home)
    const current = pathOf(tree, layerId)
    if (current === null) return
    const entry = removeAtPath(tree, current)
    if (entry === null) return
    insertAtPath(tree, path, entry)
    markPageDirty(pageId)
  }

  /**
   * What the page is called in the interface. Its directory name is what
   * everything else holds, so this touches no path and two pages are free to
   * answer to the same thing.
   */
  function renamePage(pageId: string, name: string): boolean {
    const file = pageById(pageId)
    if (!file || name.length === 0 || file.page.name === name) return false
    file.page.name = name
    markPageDirty(pageId)
    return true
  }

  /**
   * ⭐ Every write below names a side. A drag, a turn, a resize and a restyle
   * all land on the body the interface is showing — where a turn and a restyle
   * used to land on the object and so on the translation, whatever was on
   * screen.
   */
  function bodyOf(pageId: string, blockId: string) {
    return blockById(pageId, blockId)?.body ?? null
  }

  function moveLabel(pageId: string, blockId: string, x: number, y: number) {
    const body = bodyOf(pageId, blockId)
    if (!body) return
    body.x = x
    body.y = y
    markPageDirty(pageId)
  }

  function rotateLabel(pageId: string, blockId: string, rotation: number) {
    const body = bodyOf(pageId, blockId)
    if (!body) return
    body.rotation = rotation
    markPageDirty(pageId)
  }

  /** Absent rather than false where an axis is not mirrored, as the file writes it. */
  function flipLabel(pageId: string, blockId: string, flip: { x: boolean; y: boolean }) {
    const body = bodyOf(pageId, blockId)
    if (!body || (body.flipX === true) === flip.x && (body.flipY === true) === flip.y) return
    if (flip.x) body.flipX = true
    else delete body.flipX
    if (flip.y) body.flipY = true
    else delete body.flipY
    markPageDirty(pageId)
  }

  /**
   * Typing into one block, wherever what it currently reads as lives — while a
   * candidate is chosen the block is a view of its pool, not a copy. ⚠️ This
   * must never write into the block's own words while it is showing something
   * else, which would put them somewhere nobody can see them.
   *
   * ⭐ Typing into a proposal makes it yours, here rather than in the command, so
   * the amulet is on the words from the first keystroke. Left until the edit was
   * finished, a save landing mid-sentence would put a person's words on disk
   * still marked as the model's — and the model may withdraw its own.
   */
  function updateLabelText(pageId: string, blockId: string, text: string) {
    const block = blockById(pageId, blockId)
    if (!block) return
    const held = block.side === 'translation' ? block.body.candidates.find((c) => c.id === block.body.chosen) : undefined
    if (held) {
      held.lines = linesOf(text)
      held.human = true
    } else block.body.lines = linesOf(text)
    markPageDirty(pageId)
  }

  function lettering(pageId: string, blockId: string) {
    const block = blockById(pageId, blockId)
    return block?.side === 'translation' ? block : undefined
  }

  /** Null reads as the block's own lines; a candidate not in its pool is refused. */
  function setLabelTranslation(pageId: string, blockId: string, id: string | null) {
    const block = lettering(pageId, blockId)
    if (!block) return
    if (id !== null && !block.body.candidates.some((c) => c.id === id)) return
    block.body.chosen = id
    markPageDirty(pageId)
  }

  /**
   * Appended rather than inserted: arrival order is the list's order, and a
   * proposal that pushed itself in front would be ranking itself.
   */
  function addTranslation(
    pageId: string,
    blockId: string,
    lines: string[],
    by: 'human' | 'model',
    source?: string,
  ): string | null {
    const block = lettering(pageId, blockId)
    if (!block) return null
    const candidate: TranslationCandidate = { id: generateId(), lines: [...lines] }
    if (by === 'human') candidate.human = true
    else if (source) candidate.source = source
    block.body.candidates.push(candidate)
    const file = pageById(pageId)
    if (file) numberPage(file.page, faceIds.value)
    markPageDirty(pageId)
    return candidate.id
  }

  /**
   * A candidate put back where it was, which is what undoing a deletion means.
   *
   * ⚠️ The index and the id both come from the caller. A proposal that came back
   * at the end of the list would have moved without anybody moving it, and one
   * that came back under a fresh id would be a different proposal — anything
   * still naming the old one, the chosen slot included, would be left pointing
   * at nothing.
   */
  function insertTranslation(pageId: string, blockId: string, candidate: TranslationCandidate, at: number) {
    const block = lettering(pageId, blockId)
    if (!block || block.body.candidates.some((c) => c.id === candidate.id)) return
    const list = block.body.candidates
    list.splice(Math.min(Math.max(at, 0), list.length), 0, { ...candidate, lines: [...candidate.lines] })
    markPageDirty(pageId)
  }

  /**
   * Whose hand a proposal bears.
   *
   * ⭐ Stated by the caller rather than latched here. Typing into a proposal
   * makes it yours, and undoing that typing has to make it the model's again —
   * a flag that only ever went one way would leave a model unable to withdraw
   * its own untouched words.
   */
  function setTranslationHand(pageId: string, blockId: string, id: string, human: boolean) {
    const candidate = lettering(pageId, blockId)?.body.candidates.find((c) => c.id === id)
    if (!candidate) return
    if (human) candidate.human = true
    else delete candidate.human
    markPageDirty(pageId)
  }

  /**
   * The slot goes with it rather than dangling, so the block falls back to its
   * typed words — the one thing deleting a proposal must not reach.
   */
  function removeTranslation(pageId: string, blockId: string, id: string) {
    const block = lettering(pageId, blockId)
    if (!block) return
    const at = block.body.candidates.findIndex((c) => c.id === id)
    if (at === -1) return
    block.body.candidates.splice(at, 1)
    if (block.body.chosen === id) block.body.chosen = null
    markPageDirty(pageId)
  }

  /**
   * The whole source body at once. `by` is the caller's to state and never
   * guessed here — a default would be this function answering for whoever
   * called it.
   *
   * Whole rather than field by field because what writes it is one act: a run's
   * verdict, a candidate dragged onto the block, an undo of either. Copied on
   * the way in, so the caller's snapshot cannot be written through later.
   */
  function setLabelSource(pageId: string, blockId: string, source: SourceBody) {
    const block = blockById(pageId, blockId)
    if (!block || block.side !== 'source') return
    block.body = { ...source, lines: [...source.lines], style: { ...source.style } }
    markPageDirty(pageId)
  }

  /**
   * Takes a run's readings into a page's pool and says which are new, so the
   * caller can settle the slots that were waiting for exactly those.
   */
  function absorbReadings(pageId: string, arrivals: readonly OcrArrival[]): Set<string> {
    const file = pageById(pageId)
    if (!file) return new Set()
    const { candidates, born } = absorb(file.ocr.candidates, arrivals)
    if (born.length === 0) return new Set()
    file.ocr.candidates = candidates
    markPageDirty(pageId)
    return new Set(born)
  }

  /**
   * Turn a batch of readings down, or take that back.
   *
   * A batch because the unit somebody rejects is a place: taking a row out of a
   * list already happens by dragging it onto a balloon, so what is left when
   * they reach for this is "none of these" — one sentence, and one write.
   *
   * ⚠️ The words are untouched. A reading set aside is still what a model read,
   * and an object already made from it goes on saying what it says.
   */
  function setReadingsAside(pageId: string, hashes: readonly string[], aside: boolean): string[] {
    const file = pageById(pageId)
    if (!file) return []
    const wanted = new Set(hashes)
    const moved: string[] = []
    for (const reading of file.ocr.candidates) {
      if (!wanted.has(reading.hash)) continue
      if (aside) {
        if (reading.setAside === true) continue
        reading.setAside = true
      } else {
        if (reading.setAside !== true) continue
        delete reading.setAside
      }
      moved.push(reading.hash)
    }
    if (moved.length > 0) markPageDirty(pageId)
    return moved
  }

  /**
   * Correct what a reading says, where it stands.
   *
   * ⭐ The identity does not move, and that is what makes this safe to offer at
   * all. An identity is fixed when a reading is created and never recomputed,
   * so an object built from this one goes on naming it, and a rerun recognizes
   * it as one the page already has — which is to say a correction survives the
   * next run instead of being overwritten by it.
   *
   * ⚠️ `original` is left alone. It is what the model said, and the comparison
   * between the two is the only record that anybody touched this.
   */
  function setReadingText(pageId: string, hash: string, text: string) {
    const file = pageById(pageId)
    if (!file) return
    const reading = file.ocr.candidates.find((r) => r.hash === hash)
    if (!reading || reading.text === text) return
    reading.text = text
    markPageDirty(pageId)
  }

  function readingsOfPage(pageId: string): readonly OcrCandidatePersisted[] {
    return pageById(pageId)?.ocr.candidates ?? []
  }

  /**
   * For working on the recognizers rather than on a book: changing detection
   * or cropping changes every identity, so old readings never meet new ones
   * and the pool only ever grows.
   *
   * The words an object was given stay: they are the object's, and throwing
   * them away would be this button reaching past the pool it exists to clear.
   * What goes is the birth certificate — the reading it names is gone — and
   * with it the hand, since a source still marked human would sit out the next
   * run and look like the run had missed it.
   */
  function forgetReadings(pageId: string) {
    const file = pageById(pageId)
    if (!file) return
    file.ocr.candidates = []
    for (const block of textObjects(file.page.pageTree)) {
      if (block.side !== 'source' || block.body.from === undefined) continue
      delete block.body.from
      block.body.by = 'auto'
    }
    markPageDirty(pageId)
  }

  /** One block of the artwork's words, given exactly these tags — what undoing a tag write puts back. */
  function setSourceTags(pageId: string, blockId: string, tags: readonly string[]) {
    const block = blockById(pageId, blockId)
    if (block?.side !== 'source') return
    block.body.tags = normalizeTagSet(tags)
    markPageDirty(pageId)
  }

  /**
   * Puts a block into the sentence of one already on the page, directly after
   * it — in every face for a block of the artwork's words, which every face
   * reads, and in its own for lettering.
   *
   * ⭐ What a cut piece of lettering is: another piece of the same content. A
   * block that landed on the page belonging to nothing would be a sentence
   * nobody can find, drawn on top of the one it came from.
   */
  function addMemberAfter(pageId: string, afterId: string, blockId: string): boolean {
    const file = pageById(pageId)
    const after = blockById(pageId, afterId)
    if (!file || !after) return false
    const faces = after.side === 'source' ? faceIds.value : [after.face]
    let added = false
    for (const face of faces) {
      const unit = facePage(file.page, face).units.find((u) => u.members.includes(afterId))
      if (!unit || unit.members.includes(blockId)) continue
      unit.members.splice(unit.members.indexOf(afterId) + 1, 0, blockId)
      added = true
    }
    if (added) markPageDirty(pageId)
    return added
  }

  /**
   * The order the blocks of one side are read in, restated.
   *
   * ⚠️ The whole side at once, and refused unless it names exactly what the
   * side already holds. A reorder that also added or dropped a block would be
   * two acts wearing one name, and the one it does not announce is the one that
   * loses somebody's lettering.
   *
   * ⭐ The gaps stay where they are. What one holds is what goes between the
   * first block and the second, which is a fact about that seam and not about
   * either block — a space wanted between two pieces of lettering is still
   * wanted there when they change places.
   */
  function reorderMembers(
    pageId: string,
    unitId: string,
    side: TextSide,
    members: readonly string[],
    face: string = activeFace.value,
  ): boolean {
    const unit = unitById(pageId, unitId, face)
    if (!unit) return false
    const ofSide = unit.members.filter((id) => blockById(pageId, id)?.side === side)
    if (members.length !== ofSide.length) return false
    if (new Set(members).size !== members.length) return false
    if (!members.every((id) => ofSide.includes(id))) return false
    let next = 0
    unit.members = unit.members.map((id) => (ofSide.includes(id) ? members[next++]! : id))
    markPageDirty(pageId)
    return true
  }

  /** A sentence's meaning, written onto every block of the artwork's words it holds. */
  function setLabelTags(pageId: string, unitId: string, tags: readonly string[], face: string = activeFace.value) {
    const unit = unitById(pageId, unitId, face)
    if (!unit) return
    const normal = normalizeTagSet(tags)
    for (const id of unit.members) {
      const block = blockById(pageId, id)
      if (block?.side === 'source') block.body.tags = [...normal]
    }
    markPageDirty(pageId)
  }

  function setLabelStyle(pageId: string, blockId: string, style: TextStyle) {
    const body = bodyOf(pageId, blockId)
    if (!body) return
    body.style = { ...style }
    markPageDirty(pageId)
  }

  /**
   * Any entry, like the eye and the opacity — what a node carries on top of
   * itself is a property of the node, and a folder wears one as readily as a
   * layer does.
   */
  function setLayerEffects(pageId: string, layerId: string, effects: readonly LayerEffect[]) {
    const file = pageById(pageId)
    if (!file) return
    const entry = entryOnPage(file.page, layerId)
    if (!entry) return
    entry.effects = cloneEffects(effects)
    markPageDirty(pageId)
  }

  /** Every sentence of the face being worked on in the chapter, with the page it is on. */
  function allUnits(): { pageId: string; unit: TranslationUnit; tags: string[] }[] {
    const out: { pageId: string; unit: TranslationUnit; tags: string[] }[] = []
    for (const file of files.value) {
      const view = facePage(file.page, activeFace.value)
      for (const unit of view.units) out.push({ pageId: file.pageId, unit, tags: tagsOfUnit(view, unit) })
    }
    return out
  }


  function addTag(name: string, color?: string): TagDefinition | null {
    const tags = projectMeta.value.tags
    if (tags.some((t) => t.name === name)) return null
    const tag: TagDefinition = { name, color: color ?? defaultColorForTagIndex(tags.length) }
    tags.push(tag)
    markMetaDirty()
    return tag
  }

  function insertTagAt(index: number, tag: TagDefinition): void {
    projectMeta.value.tags.splice(index, 0, { ...tag })
    markMetaDirty()
  }

  /** Takes away a colour and a place in the order. The tag itself stays on
   * every object still carrying it, which is what makes the registry advisory. */
  function removeTagAt(index: number): TagDefinition | null {
    const tags = projectMeta.value.tags
    if (index < 0 || index >= tags.length) return null
    const [removed] = tags.splice(index, 1)
    markMetaDirty()
    return removed ?? null
  }

  function setTagColor(index: number, color: string): void {
    const tags = projectMeta.value.tags
    if (index < 0 || index >= tags.length) return
    tags[index].color = color
    markMetaDirty()
  }

  const pinnedLayerNames = computed(() => projectMeta.value.pinnedLayerNames ?? [])

  function togglePinnedLayerName(name: string) {
    const names = projectMeta.value.pinnedLayerNames ?? []
    projectMeta.value.pinnedLayerNames = names.includes(name)
      ? names.filter((n) => n !== name)
      : [...names, name]
    markMetaDirty()
  }

  const retouchLayerNames = computed(() => projectMeta.value.retouchLayerNames ?? [RETOUCH_LAYER_NAME])

  function toggleRetouchLayerName(name: string) {
    const names = retouchLayerNames.value
    projectMeta.value.retouchLayerNames = names.includes(name)
      ? names.filter((n) => n !== name)
      : [...names, name]
    markMetaDirty()
  }

  function updateComment(text: string) {
    if (projectMeta.value.comment === text) return
    projectMeta.value.comment = text
    markMetaDirty()
  }

  const exportMenu = computed<readonly ExportMenuEntry[]>(() => projectMeta.value.exportMenu ?? [])

  function setExportMenu(next: ExportMenuEntry[]): void {
    projectMeta.value.exportMenu = next
    markMetaDirty()
  }

  /** A new line at the bottom of the menu; its id. */
  function addExportEntry(profile: ExportProfile): string {
    const id = generateId()
    setExportMenu([...exportMenu.value, { id, profile, exportedAt: null }])
    return id
  }

  function updateExportEntry(id: string, profile: ExportProfile): void {
    setExportMenu(exportMenu.value.map((e) => (e.id === id ? { ...e, profile } : e)))
  }

  function removeExportEntry(id: string): void {
    setExportMenu(exportMenu.value.filter((e) => e.id !== id))
  }

  /**
   * A delivery made with this line, now, to this face. A line that had no face
   * of its own, or one the book no longer has, keeps the one it went to, so it
   * goes on naming the same folder after the face being worked on changes.
   */
  function markExported(id: string, face: string, at: number): void {
    setExportMenu(
      exportMenu.value.map((e) => (e.id === id ? { ...e, profile: { ...e.profile, face }, exportedAt: at } : e)),
    )
  }

  return {
    exportMenu,
    addExportEntry,
    updateExportEntry,
    removeExportEntry,
    markExported,

    rootPath,
    projectMeta,
    pinnedLayerNames,
    togglePinnedLayerName,
    retouchLayerNames,
    toggleRetouchLayerName,
    files,
    allFiles,
    dirtyPageIds,

    faces,
    faceIds,
    activeFace,
    setActiveFace,
    addFace,
    renameFace,
    deleteFace,
    setFaceState,
    faceState,
    viewOf,
    structureOf,

    folderPath,
    isOpenRoot,
    header,
    dirty,
    isOpen,
    metaDirty,
    shashokuDir,
    layersDirOf,

    pageById,
    labelsOf,
    blockById,
    unitById,
    pageOfUnit,
    placeOf,
    tagsOf,
    allUnits,
    reset,
    createNewProject,
    openExisting,
    openByPath,
    movePageBefore,
    applyOrderSnapshot,
    insertPages,
    loadFreshPage,
    tagPagesDeleted,
    untagPagesDeleted,
    flush,
    flushManifest,
    oweBeforeLayerRead,
    markPageDirty,
    addLabel,
    insertUnit,
    deleteLabel,
    moveSentences,
    renamePage,
    moveLabel,
    rotateLabel,
    flipLabel,
    updateLabelText,
    addMemberAfter,
    reorderMembers,
    setLabelTags,
    setSourceTags,
    setLabelSource,
    setLabelTranslation,
    addTranslation,
    insertTranslation,
    setTranslationHand,
    removeTranslation,
    absorbReadings,
    setReadingsAside,
    setReadingText,
    readingsOfPage,
    forgetReadings,
    setLabelStyle,
    setLayerEffects,
    setLayerVisible,
    setLayerLocked,
    setLayerLinked,
    isLinked,
    setLayerAlphaLocked,
    placeLayer,
    renameLayer,
    setLayerOpacity,
    setLayerBlendMode,
    entryById,
    pageOfEntry,
    setReadingOrder,
    setPageStructure,
    settleStructure,
    renumber,
    raiseCounters,
    readingEdgesOf,
    addReadingEdges,
    removeReadingEdges,
    addSourceEdges,
    removeSourceEdges,
    appendEntry,
    removeEntry,
    restoreEntry,
    moveLayer,
    restoreLayerAt,
    addLayer,
    dissolveFolder,
    restoreFolder,
    addTag,
    insertTagAt,
    removeTagAt,
    setTagColor,
    updateComment,
    markMetaDirty,
  }
})
