import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { deliveryFolderName, faceFolderSegments, outputFilename } from '@shared/export/profile'
import { defaultExportProfile, type ExportProfile } from '@shared/export/types'
import { layersDirOf } from '@shared/ssk/constants'
import { compositePage } from '@/lib/pageComposite'
import { encodePage } from '@/lib/pageEncode'
import { useProjectStore } from '@/stores/projectStore'

/**
 * What an export would cover. Held apart from the grid that draws it because
 * the settings panel has to state the same range the grid is showing, and
 * because the selection is the range — there is no separate "pages to export"
 * field anywhere for the two to disagree about.
 */
export const useExportStore = defineStore('export', () => {
  const project = useProjectStore()

  const selected = ref<string[]>([])
  /** Where a shift-click measures its run from. */
  const anchor = ref<string | null>(null)

  /** The menu line the panel is editing. */
  const currentId = ref<string | null>(null)
  const current = computed(() => project.exportMenu.find((e) => e.id === currentId.value) ?? null)

  /** The line a project opens on: the one it last delivered with, or the first it was given. */
  function openingId(): string | null {
    let latest = project.exportMenu[0] ?? null
    for (const entry of project.exportMenu)
      if (entry.exportedAt !== null && (latest!.exportedAt === null || entry.exportedAt > latest!.exportedAt))
        latest = entry
    return latest?.id ?? null
  }

  watch(
    () => project.rootPath,
    () => {
      currentId.value = openingId()
    },
    { immediate: true },
  )

  function select(id: string) {
    currentId.value = id
  }

  function edit(profile: ExportProfile) {
    if (currentId.value !== null) project.updateExportEntry(currentId.value, profile)
  }

  /** A copy of the line being edited, or of the defaults on an empty menu, and that copy selected. */
  function add() {
    const from = current.value?.profile ?? defaultExportProfile()
    const { name: _name, ...copy } = JSON.parse(JSON.stringify(from)) as ExportProfile
    currentId.value = project.addExportEntry(copy)
  }

  /** The line and, where it was the one being edited, the panel moved to its neighbour. */
  function remove(id: string) {
    const menu = project.exportMenu
    const at = menu.findIndex((e) => e.id === id)
    if (at === -1) return
    project.removeExportEntry(id)
    if (currentId.value === id) currentId.value = (menu[at + 1] ?? menu[at - 1])?.id ?? null
  }

  /** The face a recipe delivers in this book: its own, or the one being worked on. */
  function faceOf(profile: ExportProfile): string | null {
    if (profile.face !== undefined && project.faceIds.includes(profile.face)) return profile.face
    return project.activeFace ?? null
  }

  /** Where a recipe delivers in this book, or null for a book with no face to deliver. */
  function deliveryOf(profile: ExportProfile): { face: string; folder: string } | null {
    const face = faceOf(profile)
    const at = project.faces.find((f) => f.id === face)
    if (!at) return null
    return {
      face: at.id,
      folder: deliveryFolderName(faceFolderSegments(project.faces).get(at.id) ?? `f${at.no}`, profile),
    }
  }

  const delivery = computed(() => (current.value ? deliveryOf(current.value.profile) : null))

  const selectedSet = computed(() => new Set(selected.value))
  /**
   * The pages picked that the project still has. A deletion takes pages out
   * from under a selection without asking it, so what is counted and what is
   * acted on both read the list rather than the record of what was clicked.
   */
  const selectedPages = computed(() => project.files.filter((f) => selectedSet.value.has(f.pageId)))

  const allSelected = computed(
    () => project.files.length > 0 && selectedPages.value.length === project.files.length,
  )

  function selectAll() {
    selected.value = project.files.map((f) => f.pageId)
  }

  /** All, or none once all of them already are — one control does both. */
  function toggleAll() {
    if (allSelected.value) selected.value = []
    else selectAll()
  }

  /** The pages this store has already had an answer about. */
  let answeredFor = new Set<string>()

  // A page arrives selected and keeps whatever it was told after that. Opening
  // a project therefore still delivers all of it — every page in it is new here
  // — while making more pages leaves the ones deliberately left out alone.
  //
  // The list is replaced wholesale on both, so without the second half a run of
  // page-making silently ticked the cover and the blank pages back on, and the
  // next export shipped them.
  watch(
    () => project.files,
    () => {
      const ids = project.files.map((f) => f.pageId)
      const picked = new Set(selected.value)
      selected.value = ids.filter((id) => !answeredFor.has(id) || picked.has(id))
      answeredFor = new Set(ids)
      if (anchor.value === null || !answeredFor.has(anchor.value)) {
        anchor.value = ids[0] ?? null
      }
    },
    { immediate: true },
  )

  function isSelected(pageId: string): boolean {
    return selectedSet.value.has(pageId)
  }

  function only(pageId: string) {
    selected.value = [pageId]
    anchor.value = pageId
  }

  function toggle(pageId: string) {
    const at = selected.value.indexOf(pageId)
    if (at === -1) selected.value.push(pageId)
    else selected.value.splice(at, 1)
    anchor.value = pageId
  }

  /** Everything between the anchor and here, added to what is already picked. */
  function extendTo(pageId: string) {
    const names = project.files.map((f) => f.pageId)
    const from = anchor.value === null ? 0 : names.indexOf(anchor.value)
    const to = names.indexOf(pageId)
    if (from === -1 || to === -1) return only(pageId)
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    const run = names.slice(lo, hi + 1)
    selected.value = [...new Set([...selected.value, ...run])]
  }

  function frameSelect(pageIds: readonly string[]) {
    const hit = new Set(pageIds)
    const ordered = project.files.map((f) => f.pageId).filter((id) => hit.has(id))
    const same =
      ordered.length === selected.value.length && ordered.every((id, at) => id === selected.value[at])
    if (!same) selected.value = ordered
    anchor.value = ordered[0] ?? null
  }

  /** The line a run is out for, so that line can show it. */
  const runningId = ref<string | null>(null)

  /** Nothing while idle; the running total while a run is out. */
  const progress = ref<{ done: number; total: number } | null>(null)
  const outcome = ref<
    { kind: 'done'; written: number } | { kind: 'stopped'; written: number; why: string } | null
  >(null)
  let abandoned = false

  const running = computed(() => runningId.value !== null)

  const pagesToRun = selectedPages

  function cancel() {
    abandoned = true
  }

  /**
   * Every selected page into one line's folder.
   *
   * A failure stops the run and leaves what has already been written where it
   * is. Half a delivery that says so beats a folder tidied up behind your back,
   * and re-running writes the same names over the top.
   */
  async function run(id: string): Promise<void> {
    const root = project.rootPath
    const entry = project.exportMenu.find((e) => e.id === id)
    const target = entry ? deliveryOf(entry.profile) : null
    const pages = pagesToRun.value
    if (root === null || running.value || !entry || target === null || pages.length === 0) return
    const profile = JSON.parse(JSON.stringify(entry.profile)) as ExportProfile
    const { face, folder } = target
    // Claimed before the first await, or a second click lands while this one waits.
    runningId.value = id
    abandoned = false
    outcome.value = null
    const total = pages.length
    progress.value = { done: 0, total }
    let written = 0

    try {
      /*
       * Everything owed to `layers/` goes down first, and this waits for it.
       * Export reads the folder for full-resolution pixels, and the newest paint
       * may only be in memory — delivering a chapter short of the last thirty
       * seconds of retouching, silently, is what deferred writing costs if nobody
       * settles it.
       */
      await project.flush()

      for (const [index, file] of pages.entries()) {
        if (abandoned) return stop(written, '已取消')
        if (file.badge !== 'ok') return stop(written, `${file.page.name}:頁面無法讀取`)

        let page: OffscreenCanvas
        try {
          page = await compositePage({
            page: file.page,
            face,
            loadLayer: (name) => window.api.readImage(layersDirOf(file.pageDir), name),
          })
        } catch (err) {
          return stop(written, `${file.page.name}:${messageOf(err)}`)
        }
        try {
          const bytes = encodePage(page, profile)
          await window.api.writeExport(root, folder, outputFilename(profile, file.page.name, index), bytes)
        } catch (err) {
          return stop(written, `${file.page.name} → ${folder}/:${messageOf(err)}`)
        }
        written++
        progress.value = { done: written, total }
        // The encoder runs on this thread, so without a turn of the loop the
        // count above would only ever be painted once, at the end.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      outcome.value = { kind: 'done', written }
    } finally {
      progress.value = null
      runningId.value = null
      // The files went to `root`; another project opened meanwhile did not deliver anything.
      if (written > 0 && project.rootPath === root) project.markExported(id, face, Date.now())
    }
  }

  function stop(written: number, why: string) {
    outcome.value = { kind: 'stopped', written, why }
  }

  function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function clearOutcome() {
    outcome.value = null
  }

  return {
    selected,
    selectedSet,
    allSelected,
    selectedPages,
    progress,
    running,
    outcome,
    current,
    runningId,
    select,
    edit,
    add,
    remove,
    delivery,
    deliveryOf,
    pagesToRun,
    run,
    cancel,
    clearOutcome,
    isSelected,
    selectAll,
    toggleAll,
    only,
    toggle,
    extendTo,
    frameSelect,
  }
})
