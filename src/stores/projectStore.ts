import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ProjectFile, ProjectHeader } from '@/types/project'
import type { ProjectJson } from '@shared/project/types'
import type { PageEntry } from '@shared/ipc/channels'
import type { TagDefinition } from '@shared/tags/types'
import type { GroupLayerEntry, LayerEntry, TextLayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import {
  defaultColorForTagIndex,
  defaultProjectJson,
  parseProjectJson,
  serializeProjectJson,
} from '@shared/project/schema'
import { parseManifest, serializeManifest, unreadablePage } from '@shared/page/schema'
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
  textObjectsInReadingOrder,
  type DropTarget,
} from '@shared/page/tree'
import { linesOf } from '@shared/page/text'
import {
  edgesTouching,
  hasEdge,
  normalizeEdges,
  withoutEdges,
  wouldCycle,
  type ReadingEdge,
} from '@shared/page/readingGraph'
import { parentFolder } from '@shared/project/library'
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
  path: number[]
  orderIndex: number
  edges: ReadingEdge[]
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
  order: Array<{ id: string; index: number }>
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
  const files = ref<ProjectFile[]>([])
  const metaDirty = ref(false)
  
  const dirtyPageIds = ref<string[]>([])

  const isOpen = computed(() => rootPath.value !== null)
  const folderPath = computed(() => rootPath.value)
  const header = computed<ProjectHeader>(() => ({
    tags: projectMeta.value.tags,
    seedStyle: projectMeta.value.seedStyle,
    comment: projectMeta.value.comment,
  }))
  const dirty = computed(() => metaDirty.value || dirtyPageIds.value.length > 0)
  

  const shashokuDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR),
  )
  function pageById(pageId: string): ProjectFile | undefined {
    return files.value.find((f) => f.pageId === pageId)
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
    files.value = []
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
    await autosave.flush()
    const meta = parseProjectJson(projectMetaRaw)
    const loaded: ProjectFile[] = []
    // A page whose reading order had drifted is put right here and queued to be
    // written back, so the fix is made once rather than recomputed every open.
    const mended: string[] = []
    for (const p of pages) {
      let page = unreadablePage(p.pageId)
      try {
        const raw = await window.api.readPage(p.pageDir)
        const repair = repairPage(parseManifest(raw.manifestRaw))
        page = repair.manifest
        if (repair.repaired.length > 0) mended.push(p.pageId)
      } catch {
        // Opens empty rather than taking the whole project down. The page
        // already carries a badge saying its manifest could not be read.
      }
      loaded.push({ pageId: p.pageId, pageDir: p.pageDir, page, badge: p.badge })
    }
    rootPath.value = newRootPath
    projectMeta.value = meta
    files.value = loaded
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
    const result = await window.api.openProject(picked)
    await ingestProject(picked, result.projectMetaRaw, result.pages)
    return picked
  }


  /**
   * How far a run of page-making has got, or null when none is running. Held
   * here rather than in the panel that started it because it is the one thing
   * about a project that a view showing something else still has to know.
   */
  const creating = ref<{ done: number; total: number } | null>(null)
  let abandoned = false

  /**
   * A page for each named image in the project root. Irreversible, and the only
   * step that reads one: the pixels are copied in, and from then on the project
   * does not depend on the folder they came from.
   *
   * Answers rather than throws, because a run that stopped part way has made
   * real pages and both halves of that are worth saying. The images it got
   * through are named rather than counted, so nothing has to be worked out.
   */
  async function createPages(
    sourceNames: readonly string[],
  ): Promise<{ made: string[]; problem: string | null }> {
    const root = rootPath.value
    if (root === null || creating.value !== null || sourceNames.length === 0) {
      return { made: [], problem: null }
    }
    abandoned = false
    creating.value = { done: 0, total: sourceNames.length }
    const made: string[] = []
    let problem: string | null = null
    try {
      for (const sourceName of sourceNames) {
        if (abandoned) break
        try {
          await window.api.createPage(root, sourceName)
        } catch (err) {
          // Stops rather than skipping on: a folder that half converted itself
          // and carried on is the outcome nobody can see.
          problem = `${sourceName}:${err instanceof Error ? err.message : String(err)}`
          break
        }
        made.push(sourceName)
        creating.value = { done: made.length, total: sourceNames.length }
      }
    } finally {
      creating.value = null
      const result = await window.api.openProject(root)
      await ingestProject(root, result.projectMetaRaw, result.pages)
    }
    return { made, problem }
  }

  /** Stops after the page being made now, which cannot be taken back. */
  function abandonCreating(): void {
    abandoned = true
  }

  
  async function openByPath(rootPathToOpen: string): Promise<string | null> {
    const scan = await window.api.scanRoot(rootPathToOpen)
    if (!scan.hasShashokuDir || !scan.hasSentinel) return null
    const result = await window.api.openProject(rootPathToOpen)
    await ingestProject(rootPathToOpen, result.projectMetaRaw, result.pages)
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
        if (!file) continue
        await window.api.writePage(file.pageDir, {
          manifestRaw: serializeManifest(file.page),
        })
      }
      if (metaWasDirty) {
        // The order is taken from the pages themselves rather than kept in step
        // with them: two places holding it is two places for it to be wrong.
        await window.api.writeProjectMeta(
          shashokuDirOf(root),
          serializeProjectJson({
            ...projectMeta.value,
            pages: files.value.map((f) => f.pageId),
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



  /** A page's text objects as a reader meets them — the label list's order. */
  function labelsOf(pageId: string): TextLayerEntry[] {
    const file = pageById(pageId)
    return file ? textObjectsInReadingOrder(file.page) : []
  }

  function labelById(pageId: string, labelId: string): TextLayerEntry | undefined {
    const file = pageById(pageId)
    return file ? findTextObject(file.page.layers, labelId) : undefined
  }

  /**
   * Without a place, an object joins the end of both orders: the end of the
   * tree because that is what a new object stacks on top of, and the end of the
   * reading order because inserting near the pointer would renumber the page
   * under whoever is reading it.
   */
  function addLabel(pageId: string, label: TextLayerEntry, at?: LabelPlace) {
    const file = pageById(pageId)
    if (!file) return
    const place: LabelPlace = at ?? {
      path: [file.page.layers.length],
      orderIndex: file.page.readingOrder.length,
      // A new object is nowhere in the reading yet. Lines only arrive here on
      // the way back from a delete, carried by the place that delete recorded.
      edges: [],
    }
    // The tree can have changed shape since the place was taken — a folder the
    // path went through may be gone. Landing on top beats losing the object.
    if (!insertAtPath(file.page.layers, place.path, label)) file.page.layers.push(label)
    const orderIndex = Math.min(Math.max(place.orderIndex, 0), file.page.readingOrder.length)
    file.page.readingOrder.splice(orderIndex, 0, label.id)
    // The object is back before its lines are, so nothing put back here is ever
    // a line to somewhere that is not on the page.
    file.page.readingEdges = normalizeEdges([...file.page.readingEdges, ...place.edges])
    markPageDirty(pageId)
  }

  function deleteLabel(pageId: string, labelId: string): LabelPlace | null {
    const file = pageById(pageId)
    if (!file) return null
    const path = pathOf(file.page.layers, labelId)
    if (path === null || removeAtPath(file.page.layers, path) === null) return null
    const found = file.page.readingOrder.indexOf(labelId)
    const orderIndex = found === -1 ? file.page.readingOrder.length : found
    if (found !== -1) file.page.readingOrder.splice(found, 1)
    const edges = edgesTouching(file.page.readingEdges, new Set([labelId]))
    file.page.readingEdges = withoutEdges(file.page.readingEdges, edges)
    markPageDirty(pageId)
    return { path, orderIndex, edges }
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
      const entry = removeAtPath(file.page.layers, path)
      if (entry === null) return null
      const carried = new Set(textObjects([entry]).map((t) => t.id))
      const order: Array<{ id: string; index: number }> = []
      file.page.readingOrder.forEach((orderedId, index) => {
        if (carried.has(orderedId)) order.push({ id: orderedId, index })
      })
      file.page.readingOrder = file.page.readingOrder.filter((o) => !carried.has(o))
      const edges = edgesTouching(file.page.readingEdges, carried)
      file.page.readingEdges = withoutEdges(file.page.readingEdges, edges)
      markPageDirty(file.pageId)
      return { pageId: file.pageId, path, entry, order, edges }
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
    if (!insertAtPath(file.page.layers, removed.path, removed.entry)) {
      file.page.layers.push(removed.entry)
    }
    for (const { id, index } of removed.order) {
      file.page.readingOrder.splice(Math.min(index, file.page.readingOrder.length), 0, id)
    }
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

  function moveLabel(pageId: string, labelId: string, x: number, y: number) {
    const label = labelById(pageId, labelId)
    if (!label) return
    label.x = x
    label.y = y
    markPageDirty(pageId)
  }

  function rotateLabel(pageId: string, labelId: string, rotation: number) {
    const label = labelById(pageId, labelId)
    if (!label) return
    label.rotation = rotation
    markPageDirty(pageId)
  }

  function updateLabelText(pageId: string, labelId: string, text: string) {
    const label = labelById(pageId, labelId)
    if (!label) return
    label.lines = linesOf(text)
    markPageDirty(pageId)
  }

  function setLabelTags(pageId: string, labelId: string, tags: readonly string[]) {
    const label = labelById(pageId, labelId)
    if (!label) return
    label.tags = normalizeTagSet(tags)
    markPageDirty(pageId)
  }

  function setLabelStyle(pageId: string, labelId: string, style: TextStyle) {
    const label = labelById(pageId, labelId)
    if (!label) return
    label.style = { ...style }
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
    for (const { pageId, label } of allTextObjects()) {
      if (!label.tags.includes(from)) continue
      label.tags = normalizeTagSet(label.tags.map((t) => (t === from ? to : t)))
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
    dirtyPageIds,
    
    folderPath,
    header,
    dirty,
    isOpen,
    metaDirty,
    shashokuDir,
    layersDirOf,
    
    pageById,
    labelsOf,
    labelById,
    reset,
    createNewProject,
    openExisting,
    openByPath,
    creating,
    createPages,
    abandonCreating,
    flush: autosave.flush,
    addLabel,
    deleteLabel,
    renamePage,
    moveLabel,
    rotateLabel,
    updateLabelText,
    setLabelTags,
    setLabelStyle,
    allTextObjects,
    setLayerVisible,
    setLayerLocked,
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
