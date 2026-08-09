import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { outputFilename, profileFolderName } from '@shared/export/profile'
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

  /**
   * The profile being looked at, which is also the one an export delivers.
   * One at a time: a project keeps a handful, each producing a whole delivery,
   * and pressing export is a decision about which delivery to make rather than
   * how many at once.
   */
  const activeProfile = ref(0)

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

  // A profile removed from under the cursor leaves the index pointing past the
  // end, which would read as no profile at all.
  watch(
    () => project.exportProfiles.length,
    (count) => {
      activeProfile.value = Math.max(0, Math.min(activeProfile.value, count - 1))
    },
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

  /** Nothing while idle; the running total while a run is out. */
  const progress = ref<{ done: number; total: number } | null>(null)
  const outcome = ref<
    { kind: 'done'; written: number } | { kind: 'stopped'; written: number; why: string } | null
  >(null)
  let abandoned = false

  const running = computed(() => progress.value !== null)

  const profilesToRun = computed(() => {
    const profile = project.exportProfiles[activeProfile.value]
    return profile === undefined ? [] : [profile]
  })
  const pagesToRun = selectedPages

  function cancel() {
    abandoned = true
  }

  /**
   * Every selected page through every selected profile.
   *
   * The page loop is outer so one composite serves all the profiles that want
   * it, and so a failure stops with whole pages behind it rather than a page
   * delivered to some profiles and not others.
   *
   * A failure stops the run and leaves what has already been written where it
   * is. Half a delivery that says so beats a folder tidied up behind your back,
   * and re-running writes the same names over the top.
   */
  async function run(): Promise<void> {
    const root = project.rootPath
    const profiles = profilesToRun.value
    const pages = pagesToRun.value
    if (root === null || running.value || profiles.length === 0 || pages.length === 0) return

    abandoned = false
    outcome.value = null
    progress.value = { done: 0, total: pages.length * profiles.length }
    let written = 0

    try {
      for (const [index, file] of pages.entries()) {
        if (abandoned) return stop(written, '已取消')
        if (file.badge !== 'ok') return stop(written, `${file.page.name}:頁面無法讀取`)

        let page: OffscreenCanvas
        try {
          page = await compositePage({
            page: file.page,
            loadLayer: (name) => window.api.readImage(layersDirOf(file.pageDir), name),
          })
        } catch (err) {
          return stop(written, `${file.page.name}:${messageOf(err)}`)
        }

        for (const profile of profiles) {
          if (abandoned) return stop(written, '已取消')
          const folder = profileFolderName(profile)
          try {
            const bytes = encodePage(page, profile)
            await window.api.writeExport(
              root,
              folder,
              outputFilename(profile, file.page.name, index),
              bytes,
            )
          } catch (err) {
            return stop(written, `${file.page.name} → ${folder}/:${messageOf(err)}`)
          }
          written++
          progress.value = { done: written, total: pages.length * profiles.length }
          // The encoder runs on this thread, so without a turn of the loop the
          // count above would only ever be painted once, at the end.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      outcome.value = { kind: 'done', written }
    } finally {
      progress.value = null
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
    profilesToRun,
    pagesToRun,
    run,
    cancel,
    clearOutcome,
    activeProfile,
    isSelected,
    selectAll,
    toggleAll,
    only,
    toggle,
    extendTo,
  }
})
