import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ProjectFile, ProjectHeader } from '@/types/project'
import type { ProjectJson } from '@shared/project/types'
import type { PageEntry } from '@shared/ipc/channels'
import type { TagDefinition } from '@shared/tags/types'
import type {
  GroupLayerEntry,
  LayerEntry,
  OcrCandidatePersisted,
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
  defaultOcr,
  generateId,
  parseManifest,
  parseOcr,
  serializeManifest,
  serializeOcr,
  unreadablePage,
} from '@shared/page/schema'
import { repairPage } from '@shared/page/repair'
import {
  dissolveGroupAt,
  findEntry,
  findTextObject,
  insertAtPath,
  moveEntry,
  pathOf,
  removeAtPath,
  restoreGroupAt,
  textObjects,
  type DropTarget,
} from '@shared/page/tree'
import { linesOf, type TextSide } from '@shared/page/text'
import {
  candidateFits,
  findUnit,
  placeOfBlock,
  unitsInReadingOrder,
  type UnitPlace,
} from '@shared/page/units'
import {
  edgesTouching,
  hasEdge,
  normalizeEdges,
  withoutEdges,
  wouldCycle,
  type ReadingEdge,
} from '@shared/page/readingGraph'
import { parentFolder } from '@shared/project/library'
import { applyPageOrderSnapshot } from '@shared/project/pages'
import { assertDistinctFolders } from '@shared/export/profile'
import type { ExportProfile } from '@shared/export/types'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { SHASHOKU_DIR, layersDirOf } from '@shared/ssk/constants'
import type { TextStyle } from '@shared/text-style/types'
import { normalizeTagSet } from '@shared/tags/set'
import { createAutosave } from '@/lib/autosave'

/**
 * Where a text object sits, in every sense at once: its place in the tree,
 * which is stacking order, its place in the reading order, and the lines drawn
 * to and from it. Undo has to put a deleted object back into all three, and
 * none of them can be worked out from the others.
 *
 * The lines ride along rather than being left for `repair` to sweep. A sweep
 * happens at the next open, so leaving them would make the undo look right
 * today and lose the lines tomorrow.
 */
export interface LabelPlace {
  /** One per block, front to back, so putting them back cannot shift each other. */
  paths: number[][]
  orderIndex: number
  edges: ReadingEdge[]
}

/** A translation and the blocks that say it, enough to put on a page. */
export interface TranslationParts {
  unit: TranslationUnit
  blocks: readonly TextLayerEntry[]
}

/** One translation taken off a page, with everything needed to put it back. */
export interface RemovedTranslation {
  unit: TranslationUnit
  blocks: Array<{ path: number[]; entry: TextLayerEntry }>
  orderIndex: number
  edges: ReadingEdge[]
}

/** Tree order between two paths: earlier sibling first, parent before child. */
function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}


/** What one side of a translation says; see `sideWordsOf`. */
export interface SideWords {
  /** Each block's own lines, by id. */
  lines: Record<string, string[]>
  /** The chosen proposal's pieces, or null when nothing is chosen. */
  pieces: string[][] | null
  separators: string[]
}

/**
 * One entry taken off a page, with everything needed to put it back.
 *
 * A folder carries its whole subtree, so removing one takes text objects out
 * of the reading order that were never named directly. Their places are read
 * off the sequence before anything moves — working them out afterwards is
 * impossible, since each removal shifts the ones behind it.
 */
export interface RemovedEntry {
  pageId: string
  path: number[]
  entry: LayerEntry
  /**
   * Where each block it carried stood in its translation, so putting the entry
   * back puts it back into the same translation at the same place.
   */
  membership: Array<{ unit: string; side: TextSide; at: number; separator: string }>
  /**
   * The translations that had nothing left once it went. A side with no block
   * is not a smaller translation, it is a row the list cannot draw — so the
   * whole thing comes off, and comes back whole.
   */
  units: RemovedTranslation[]
  /** Every line with an end on anything the removal carried away. */
  edges: ReadingEdge[]
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
    const loaded: ProjectFile[] = []
    // A page whose reading order had drifted is put right here and queued to be
    // written back, so the fix is made once rather than recomputed every open.
    const mended: string[] = []
    for (const p of pages) {
      let page = unreadablePage(p.pageId)
      let ocr = defaultOcr(page.width, page.height)
      try {
        const raw = await window.api.readPage(p.pageDir)
        const repair = repairPage(parseManifest(raw.manifestRaw))
        page = repair.manifest
        if (repair.repaired.length > 0) mended.push(p.pageId)
        // Readings fail on their own: a page whose ocr.json is unreadable is
        // still a page someone can typeset.
        ocr = raw.ocrRaw === null ? defaultOcr(page.width, page.height) : parseOcr(raw.ocrRaw)
      } catch {
        // Opens empty rather than taking the whole project down. The page
        // already carries a badge saying its manifest could not be read.
      }
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
    if (!sameOrder(meta.pages, loaded)) markMetaDirty()
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
    try {
      const raw = await window.api.readPage(pageDir)
      const page = repairPage(parseManifest(raw.manifestRaw)).manifest
      const ocr = raw.ocrRaw === null ? defaultOcr(page.width, page.height) : parseOcr(raw.ocrRaw)
      return { pageId, pageDir, page, ocr, badge: 'ok' }
    } catch {
      const page = unreadablePage(pageId)
      return { pageId, pageDir, page, ocr: defaultOcr(page.width, page.height), badge: 'damaged' }
    }
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



  /** Which page holds a translation, or null where none does. */
  function pageOfUnit(unitId: string): string | null {
    for (const file of files.value) {
      if (file.page.translationUnits.some((u) => u.id === unitId)) return file.pageId
    }
    return null
  }

  /** A page's translations as a reader meets them — the label list's order. */
  function labelsOf(pageId: string): TranslationUnit[] {
    const file = pageById(pageId)
    return file ? unitsInReadingOrder(file.page) : []
  }

  function unitById(pageId: string, unitId: string): TranslationUnit | undefined {
    const file = pageById(pageId)
    return file ? findUnit(file.page, unitId) : undefined
  }

  function blockById(pageId: string, blockId: string): TextLayerEntry | undefined {
    const file = pageById(pageId)
    return file ? findTextObject(file.page.layers, blockId) : undefined
  }

  /** Which translation a block of lettering says, and where in it. */
  function placeOf(pageId: string, blockId: string): UnitPlace | undefined {
    const file = pageById(pageId)
    return file ? placeOfBlock(file.page, blockId) : undefined
  }

  /**
   * Without a place, a translation joins the end of both orders: the end of the
   * tree because that is what new lettering stacks on top of, and the end of the
   * reading order because inserting near the pointer would renumber the page
   * under whoever is reading it.
   *
   * The unit and its blocks arrive together, so no moment exists where a block
   * is on the page with nothing saying what it is.
   */
  function addLabel(pageId: string, label: TranslationParts, at?: LabelPlace) {
    const file = pageById(pageId)
    if (!file) return
    const place: LabelPlace = at ?? {
      paths: label.blocks.map((_, i) => [file.page.layers.length + i]),
      orderIndex: file.page.readingOrder.length,
      // A new translation is nowhere in the reading yet. Lines only arrive here
      // on the way back from a delete, carried by the place that delete recorded.
      edges: [],
    }
    label.blocks.forEach((block, i) => {
      // The tree can have changed shape since the place was taken — a folder the
      // path went through may be gone. Landing on top beats losing the block.
      const path = place.paths[i]
      if (path === undefined || !insertAtPath(file.page.layers, path, block))
        file.page.layers.push(block)
    })
    file.page.translationUnits.push(label.unit)
    const orderIndex = Math.min(Math.max(place.orderIndex, 0), file.page.readingOrder.length)
    file.page.readingOrder.splice(orderIndex, 0, label.unit.id)
    // The translation is back before its lines are, so nothing put back here is
    // ever a line to somewhere that is not on the page.
    file.page.readingEdges = normalizeEdges([...file.page.readingEdges, ...place.edges])
    markPageDirty(pageId)
  }

  /**
   * A whole translation off the page: both sides' blocks, the unit, its place in
   * the reading and every line touching it.
   *
   * ⭐ Both sides, always. Half a translation is not a smaller translation, it is
   * a row the list cannot draw — which is why deleting a row has always taken
   * the artwork's words with the lettering.
   */
  function deleteLabel(pageId: string, unitId: string): RemovedTranslation | null {
    const file = pageById(pageId)
    if (!file) return null
    const at = file.page.translationUnits.findIndex((u) => u.id === unitId)
    if (at === -1) return null
    const unit = file.page.translationUnits[at]
    const ids = [...unit.source.members, ...unit.translation.members]
    // Deepest and last first, so that taking one out cannot shift the path of
    // one still to come — and the record then reads front to back for putting
    // them all back.
    const removals = ids
      .map((id) => ({ id, path: pathOf(file.page.layers, id) }))
      .filter((p): p is { id: string; path: number[] } => p.path !== null)
      .sort((a, b) => comparePaths(b.path, a.path))
    const blocks: Array<{ path: number[]; entry: TextLayerEntry }> = []
    for (const { path } of removals) {
      const entry = removeAtPath(file.page.layers, path)
      if (entry !== null && entry.kind === 'text') blocks.unshift({ path, entry })
    }
    file.page.translationUnits.splice(at, 1)
    const found = file.page.readingOrder.indexOf(unitId)
    const orderIndex = found === -1 ? file.page.readingOrder.length : found
    if (found !== -1) file.page.readingOrder.splice(found, 1)
    const edges = edgesTouching(file.page.readingEdges, new Set([unitId]))
    file.page.readingEdges = withoutEdges(file.page.readingEdges, edges)
    markPageDirty(pageId)
    return { unit, blocks, orderIndex, edges }
  }

  /**
   * Any entry, not only a text object: hiding a folder is how a whole run of
   * them goes away at once.
   */
  function setLayerVisible(pageId: string, layerId: string, visible: boolean) {
    const file = pageById(pageId)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
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
    const entry = findEntry(file.page.layers, layerId)
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
    const entry = findEntry(file.page.layers, layerId)
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
    const entry = findEntry(file.page.layers, layerId)
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
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.kind !== 'raster' || entry.alphaLocked === alphaLocked) return false
    entry.alphaLocked = alphaLocked
    markPageDirty(pageId)
    return true
  }

  /** Any entry too — a folder carries blending so a run can be faded as one. */
  function setLayerOpacity(pageId: string, layerId: string, opacity: number) {
    const file = pageById(pageId)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
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
    const entry = findEntry(file.page.layers, layerId)
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
  function addLayer(pageId: string, entry: LayerEntry, path?: number[]) {
    const file = pageById(pageId)
    if (!file) return
    const at = path ?? [file.page.layers.length]
    if (!insertAtPath(file.page.layers, at, entry)) file.page.layers.push(entry)
    markPageDirty(pageId)
  }

  function dissolveFolder(
    pageId: string,
    folderId: string,
  ): { path: number[]; folder: GroupLayerEntry } | null {
    const file = pageById(pageId)
    if (!file) return null
    const path = pathOf(file.page.layers, folderId)
    if (path === null) return null
    const folder = dissolveGroupAt(file.page.layers, path)
    if (folder === null) return null
    markPageDirty(pageId)
    return { path, folder }
  }

  function restoreFolder(pageId: string, path: number[], folder: GroupLayerEntry) {
    const file = pageById(pageId)
    if (!file) return
    if (!restoreGroupAt(file.page.layers, path, folder)) return
    markPageDirty(pageId)
  }

  function setReadingOrder(pageId: string, order: string[]) {
    const file = pageById(pageId)
    if (!file) return
    file.page.readingOrder = order
    markPageDirty(pageId)
  }

  function readingEdgesOf(pageId: string): readonly ReadingEdge[] {
    return pageById(pageId)?.page.readingEdges ?? []
  }

  /**
   * Draws lines and answers with the ones it took, which is what undo has to
   * rub out — a gesture that repeats a line already on the page must not take
   * that line away when it is taken back.
   *
   * Judged one at a time against what is held so far, so a gesture cannot close
   * a ring against its own earlier link either. The canvas asks the same
   * question while the pointer is still down and draws a target it would refuse
   * as refused, so reaching this refusal means something got past that.
   */
  function addReadingEdges(pageId: string, edges: readonly ReadingEdge[]): ReadingEdge[] {
    const file = pageById(pageId)
    if (!file) return []
    const taken: ReadingEdge[] = []
    for (const edge of edges) {
      const held = file.page.readingEdges
      if (hasEdge(held, edge) || wouldCycle(held, edge)) continue
      file.page.readingEdges = normalizeEdges([...held, edge])
      taken.push(edge)
    }
    if (taken.length > 0) markPageDirty(pageId)
    return taken
  }

  function removeReadingEdges(pageId: string, edges: readonly ReadingEdge[]): void {
    const file = pageById(pageId)
    if (!file || edges.length === 0) return
    const left = withoutEdges(file.page.readingEdges, edges)
    if (left.length === file.page.readingEdges.length) return
    file.page.readingEdges = left
    markPageDirty(pageId)
  }

  /** On top of everything, which is where an object arriving on a page belongs. */
  function appendEntry(pageId: string, entry: LayerEntry) {
    const file = pageById(pageId)
    if (!file) return
    file.page.layers.push(entry)
    markPageDirty(pageId)
  }

  /** Which page an entry is on, since the selection reaches across all of them. */
  function pageOfEntry(id: string): string | null {
    for (const file of files.value) {
      if (findEntry(file.page.layers, id)) return file.pageId
    }
    return null
  }

  /** Anything on any page of the chapter — the selection reaches across them. */
  function entryById(id: string): LayerEntry | undefined {
    for (const file of files.value) {
      const found = findEntry(file.page.layers, id)
      if (found) return found
    }
    return undefined
  }

  function removeEntry(id: string): RemovedEntry | null {
    for (const file of files.value) {
      const path = pathOf(file.page.layers, id)
      if (path === null) continue
      const carried = textObjects([findEntry(file.page.layers, id) as LayerEntry])
      // Read before anything moves: once a block is out, nothing on the page
      // can say where in its translation it stood.
      const membership = carried.flatMap((block) => {
        const place = placeOfBlock(file.page, block.id)
        if (place === undefined) return []
        const list = place.side === 'source' ? place.unit.source : place.unit.translation
        return [
          {
            unit: place.unit.id,
            side: place.side,
            at: place.at,
            separator: list.separators[Math.max(place.at - 1, 0)] ?? '',
          },
        ]
      })
      const entry = removeAtPath(file.page.layers, path)
      if (entry === null) return null

      const emptied = new Set<string>()
      for (const block of carried) {
        const place = placeOfBlock(file.page, block.id)
        if (place === undefined) continue
        const list = place.side === 'source' ? place.unit.source : place.unit.translation
        const at = list.members.indexOf(block.id)
        if (at === -1) continue
        list.members.splice(at, 1)
        list.separators.splice(Math.max(at - 1, 0), 1)
        if (list.members.length === 0) emptied.add(place.unit.id)
      }
      // A translation left with an empty side comes off whole, which is what
      // deleting a row has always meant.
      const units = [...emptied].flatMap((unitId) => {
        const gone = deleteLabel(file.pageId, unitId)
        return gone === null ? [] : [gone]
      })

      const edges = edgesTouching(file.page.readingEdges, new Set(units.map((u) => u.unit.id)))
      file.page.readingEdges = withoutEdges(file.page.readingEdges, edges)
      markPageDirty(file.pageId)
      return { pageId: file.pageId, path, entry, membership, units, edges }
    }
    return null
  }

  /**
   * Undoes one removal. Reading-order places go back in ascending order, which
   * is what makes each recorded index still mean what it meant: the ones ahead
   * of it are already back in place by the time it lands.
   */
  function restoreEntry(removed: RemovedEntry): void {
    const file = pageById(removed.pageId)
    if (!file) return
    // The translations first, so the blocks coming back have a list to land in
    // — and backwards, so each recorded place still means what it meant: the
    // one taken out last is the one nothing has moved under yet.
    for (const gone of [...removed.units].reverse()) {
      addLabel(
        removed.pageId,
        { unit: gone.unit, blocks: gone.blocks.map((b) => b.entry) },
        {
          paths: gone.blocks.map((b) => b.path),
          orderIndex: gone.orderIndex,
          edges: gone.edges,
        },
      )
    }
    if (!insertAtPath(file.page.layers, removed.path, removed.entry)) {
      file.page.layers.push(removed.entry)
    }
    const carried = textObjects([removed.entry])
    removed.membership.forEach(({ unit: unitId, side, at, separator }, i) => {
      const unit = findUnit(file.page, unitId)
      const block = carried[i]
      if (unit === undefined || block === undefined) return
      const list = side === 'source' ? unit.source : unit.translation
      if (list.members.includes(block.id)) return
      const index = Math.min(at, list.members.length)
      list.members.splice(index, 0, block.id)
      if (list.members.length > 1) list.separators.splice(Math.max(index - 1, 0), 0, separator)
    })
    file.page.readingEdges = normalizeEdges([...file.page.readingEdges, ...removed.edges])
    markPageDirty(removed.pageId)
  }

  function moveLayer(pageId: string, fromPath: number[], target: DropTarget): boolean {
    const file = pageById(pageId)
    if (!file) return false
    if (!moveEntry(file.page.layers, fromPath, target)) return false
    markPageDirty(pageId)
    return true
  }

  /**
   * Undoes a restack by putting an entry back at the path it left, which the
   * drop rules cannot express: their indices are read before the entry comes
   * out, and running them backwards lands one place off.
   */
  function restoreLayerAt(pageId: string, layerId: string, path: number[]) {
    const file = pageById(pageId)
    if (!file) return
    const current = pathOf(file.page.layers, layerId)
    if (current === null) return
    const entry = removeAtPath(file.page.layers, current)
    if (entry === null) return
    insertAtPath(file.page.layers, path, entry)
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

  /**
   * Typing into one block, wherever what it currently reads as lives — while a
   * candidate is chosen the block is a view of the pool, not a copy. ⚠️ This
   * must never write into the block's own words while it is showing something
   * else, which would put them somewhere nobody can see them.
   *
   * ⭐ Typing into a proposal makes it yours, here rather than in the command, so
   * the amulet is on the words from the first keystroke. Left until the edit was
   * finished, a save landing mid-sentence would put a person's words on disk
   * still marked as the model's — and the model may withdraw its own.
   */
  function updateLabelText(pageId: string, blockId: string, text: string) {
    const file = pageById(pageId)
    const block = file ? findTextObject(file.page.layers, blockId) : undefined
    if (!file || !block) return
    const place = block.side === 'translation' ? placeOfBlock(file.page, blockId) : undefined
    const held = place?.unit.candidates.find((c) => c.id === place.unit.chosen)
    if (held && place) {
      held.pieces[place.at] = linesOf(text)
      held.human = true
    } else block.body.lines = linesOf(text)
    markPageDirty(pageId)
  }

  /**
   * Null reads as the words in the unit's own blocks.
   *
   * ⚠️ Refused where the candidate has a different number of blocks than the
   * lettering is set in: there would be no block to show a piece from, so the
   * page would read as something no block on it is saying.
   */
  function setLabelTranslation(pageId: string, unitId: string, id: string | null) {
    const unit = unitById(pageId, unitId)
    if (!unit) return
    if (id !== null && !candidateFits(unit, id)) return
    unit.chosen = id
    markPageDirty(pageId)
  }

  /**
   * Appended rather than inserted: arrival order is the list's order, and a
   * proposal that pushed itself in front would be ranking itself.
   */
  function addTranslation(
    pageId: string,
    unitId: string,
    pieces: string[][],
    by: 'human' | 'model',
    source?: string,
  ): string | null {
    const unit = unitById(pageId, unitId)
    if (!unit) return null
    const candidate: TranslationCandidate = { id: generateId(), pieces }
    if (by === 'human') candidate.human = true
    else if (source) candidate.source = source
    unit.candidates.push(candidate)
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
  function insertTranslation(
    pageId: string,
    unitId: string,
    candidate: TranslationCandidate,
    at: number,
  ) {
    const unit = unitById(pageId, unitId)
    if (!unit || unit.candidates.some((c) => c.id === candidate.id)) return
    const list = unit.candidates
    list.splice(Math.min(Math.max(at, 0), list.length), 0, {
      ...candidate,
      pieces: candidate.pieces.map((piece) => [...piece]),
    })
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
  function setTranslationHand(pageId: string, unitId: string, id: string, human: boolean) {
    const candidate = unitById(pageId, unitId)?.candidates.find((c) => c.id === id)
    if (!candidate) return
    if (human) candidate.human = true
    else delete candidate.human
    markPageDirty(pageId)
  }

  /**
   * The slot goes with it rather than dangling, so the translation falls back
   * to its typed words — the one thing deleting a proposal must not reach.
   */
  function removeTranslation(pageId: string, unitId: string, id: string) {
    const unit = unitById(pageId, unitId)
    if (!unit) return
    const at = unit.candidates.findIndex((c) => c.id === id)
    if (at === -1) return
    unit.candidates.splice(at, 1)
    if (unit.chosen === id) unit.chosen = null
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
  function setReadingsAside(pageId: string, hashes: readonly string[], aside: boolean) {
    const file = pageById(pageId)
    if (!file) return
    const wanted = new Set(hashes)
    let moved = false
    for (const reading of file.ocr.candidates) {
      if (!wanted.has(reading.hash)) continue
      if (aside) {
        if (reading.setAside === true) continue
        reading.setAside = true
      } else {
        if (reading.setAside !== true) continue
        delete reading.setAside
      }
      moved = true
    }
    if (moved) markPageDirty(pageId)
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
    for (const block of textObjects(file.page.layers)) {
      if (block.side !== 'source' || block.body.from === undefined) continue
      delete block.body.from
      block.body.by = 'auto'
    }
    markPageDirty(pageId)
  }

  /**
   * Puts a block into the same translation, and the same side, as one already
   * in it — directly after it.
   *
   * ⭐ What a copy of a piece of lettering is: another piece of the same
   * content. A block that landed on the page belonging to nothing would be a
   * translation nobody can find, drawn on top of the one it came from.
   *
   * The gap it arrives with is empty, as a sound split in two wants.
   */
  function addMemberAfter(pageId: string, afterId: string, blockId: string): boolean {
    const file = pageById(pageId)
    const place = file ? placeOfBlock(file.page, afterId) : undefined
    if (!file || place === undefined) return false
    const list = place.side === 'source' ? place.unit.source : place.unit.translation
    if (list.members.includes(blockId)) return false
    list.members.splice(place.at + 1, 0, blockId)
    list.separators.splice(place.at, 0, '')
    markPageDirty(pageId)
    return true
  }

  /**
   * Everything one side of a translation says, held apart from where its blocks
   * stand: each block's own lines, the chosen proposal's pieces, and the seams.
   * Read and written whole, so a step that cuts one block into several can put
   * the words back exactly as they were.
   */
  function sideWordsOf(pageId: string, blockId: string): SideWords | undefined {
    const file = pageById(pageId)
    const place = file ? placeOfBlock(file.page, blockId) : undefined
    if (!file || place === undefined) return undefined
    const list = place.side === 'source' ? place.unit.source : place.unit.translation
    const lines: Record<string, string[]> = {}
    for (const id of list.members) {
      const block = findTextObject(file.page.layers, id)
      if (block) lines[id] = [...block.body.lines]
    }
    const chosen =
      place.side === 'translation'
        ? place.unit.candidates.find((c) => c.id === place.unit.chosen)
        : undefined
    return {
      lines,
      pieces: chosen ? chosen.pieces.map((piece) => [...piece]) : null,
      separators: [...list.separators],
    }
  }

  function setSideWords(pageId: string, blockId: string, words: SideWords) {
    const file = pageById(pageId)
    const place = file ? placeOfBlock(file.page, blockId) : undefined
    if (!file || place === undefined) return
    const list = place.side === 'source' ? place.unit.source : place.unit.translation
    for (const [id, lines] of Object.entries(words.lines)) {
      const block = findTextObject(file.page.layers, id)
      if (block) block.body.lines = [...lines]
    }
    const chosen = place.unit.candidates.find((c) => c.id === place.unit.chosen)
    if (chosen && words.pieces && place.side === 'translation') {
      chosen.pieces = words.pieces.map((piece) => [...piece])
    }
    list.separators = [...words.separators]
    markPageDirty(pageId)
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
  ): boolean {
    const unit = unitById(pageId, unitId)
    if (!unit) return false
    const list = side === 'source' ? unit.source : unit.translation
    if (members.length !== list.members.length) return false
    if (new Set(members).size !== members.length) return false
    if (!members.every((id) => list.members.includes(id))) return false
    list.members = [...members]
    markPageDirty(pageId)
    return true
  }

  function setLabelTags(pageId: string, unitId: string, tags: readonly string[]) {
    const unit = unitById(pageId, unitId)
    if (!unit) return
    unit.tags = normalizeTagSet(tags)
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
    const entry = findEntry(file.page.layers, layerId)
    if (!entry) return
    entry.effects = cloneEffects(effects)
    markPageDirty(pageId)
  }

  /** Every text object in the chapter, with the page each one came from. */
  function allTextObjects(): { pageId: string; label: TextLayerEntry }[] {
    const out: { pageId: string; label: TextLayerEntry }[] = []
    for (const file of files.value) {
      for (const label of textObjects(file.page.layers)) out.push({ pageId: file.pageId, label })
    }
    return out
  }

  /** Every translation in the chapter, with the page it is on. */
  function allUnits(): { pageId: string; unit: TranslationUnit }[] {
    const out: { pageId: string; unit: TranslationUnit }[] = []
    for (const file of files.value) {
      for (const unit of file.page.translationUnits) out.push({ pageId: file.pageId, unit })
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

  function moveTag(from: number, to: number): void {
    const tags = projectMeta.value.tags
    if (from < 0 || from >= tags.length || to < 0 || to >= tags.length || from === to) return
    const [moved] = tags.splice(from, 1)
    if (moved) tags.splice(to, 0, moved)
    markMetaDirty()
  }

  function setTagColor(index: number, color: string): void {
    const tags = projectMeta.value.tags
    if (index < 0 || index >= tags.length) return
    tags[index].color = color
    markMetaDirty()
  }

  /**
   * Renaming reaches every object carrying the old name — the name *is* the
   * reference, so leaving them behind would strand them under a word the user
   * just said they no longer use. Refused when the new name is already taken,
   * which also keeps the inverse well defined: renaming back cannot collide.
   */
  function renameTag(from: string, to: string): boolean {
    const tags = projectMeta.value.tags
    const index = tags.findIndex((t) => t.name === from)
    if (index === -1 || from === to) return false
    if (tags.some((t) => t.name === to)) return false
    tags[index].name = to
    markMetaDirty()
    for (const { pageId, unit } of allUnits()) {
      if (!unit.tags.includes(from)) continue
      unit.tags = normalizeTagSet(unit.tags.map((t) => (t === from ? to : t)))
      markPageDirty(pageId)
    }
    return true
  }


  function updateComment(text: string) {
    if (projectMeta.value.comment === text) return
    projectMeta.value.comment = text
    markMetaDirty()
  }

  const exportProfiles = computed(() => projectMeta.value.exportProfiles)

  /**
   * Both writers refuse rather than repair: a profile that would deliver into
   * a folder another one already owns has to be changed by whoever asked for
   * it, since silently nudging it would put the files somewhere they did not
   * choose.
   */
  function addExportProfile(profile: ExportProfile): void {
    const next = [...projectMeta.value.exportProfiles, profile]
    assertDistinctFolders(next)
    projectMeta.value.exportProfiles = next
    markMetaDirty()
  }

  function updateExportProfile(index: number, profile: ExportProfile): void {
    const profiles = projectMeta.value.exportProfiles
    if (index < 0 || index >= profiles.length) return
    const next = profiles.map((p, i) => (i === index ? profile : p))
    assertDistinctFolders(next)
    projectMeta.value.exportProfiles = next
    markMetaDirty()
  }

  function removeExportProfile(index: number): void {
    const profiles = projectMeta.value.exportProfiles
    if (index < 0 || index >= profiles.length) return
    projectMeta.value.exportProfiles = profiles.filter((_, i) => i !== index)
    markMetaDirty()
  }

  return {
    exportProfiles,
    addExportProfile,
    updateExportProfile,
    removeExportProfile,
    
    rootPath,
    projectMeta,
    files,
    allFiles,
    dirtyPageIds,

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
    deleteLabel,
    renamePage,
    moveLabel,
    rotateLabel,
    updateLabelText,
    addMemberAfter,
    sideWordsOf,
    setSideWords,
    reorderMembers,
    setLabelTags,
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
    allTextObjects,
    setLayerVisible,
    setLayerLocked,
    setLayerAlphaLocked,
    placeLayer,
    renameLayer,
    setLayerOpacity,
    setLayerBlendMode,
    entryById,
    pageOfEntry,
    setReadingOrder,
    readingEdgesOf,
    addReadingEdges,
    removeReadingEdges,
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
    moveTag,
    setTagColor,
    renameTag,
    updateComment,
    markMetaDirty,
  }
})
