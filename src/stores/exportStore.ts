import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { outputFilename, profileFolderName } from '@shared/export/profile'
import { layersDirOf } from '@shared/ssk/constants'
import { compositePage } from '@/lib/pageComposite'
import { encodePage } from '@/lib/pageEncode'
import { rawsDirOf } from '@/stores/libraryStore'
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
  const allSelected = computed(
    () => project.files.length > 0 && selected.value.length === project.files.length,
  )

  function selectAll() {
    selected.value = project.files.map((f) => f.filename)
  }

  /** All, or none once all of them already are — one control does both. */
  function toggleAll() {
    if (allSelected.value) selected.value = []
    else selectAll()
  }

  // Opening a project delivers all of it: "press export and change nothing" is
  // the complete chapter, which is what almost every export is.
  watch(
    () => project.files,
    () => {
      selectAll()
      anchor.value = project.files[0]?.filename ?? null
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

  function isSelected(filename: string): boolean {
    return selectedSet.value.has(filename)
  }

  function only(filename: string) {
    selected.value = [filename]
    anchor.value = filename
  }

  function toggle(filename: string) {
    const at = selected.value.indexOf(filename)
    if (at === -1) selected.value.push(filename)
    else selected.value.splice(at, 1)
    anchor.value = filename
  }

  /** Everything between the anchor and here, added to what is already picked. */
  function extendTo(filename: string) {
    const names = project.files.map((f) => f.filename)
    const from = anchor.value === null ? 0 : names.indexOf(anchor.value)
    const to = names.indexOf(filename)
    if (from === -1 || to === -1) return only(filename)
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
  const pagesToRun = computed(() => project.files.filter((f) => selectedSet.value.has(f.filename)))

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
        if (file.badge !== 'ok') return stop(written, `${file.filename}:圖檔不存在`)

        let page: OffscreenCanvas
        try {
          const raw = await window.api.readImage(rawsDirOf(root), file.filename)
          page = await compositePage({
            raw,
            page: file.page,
            loadLayer: (name) => window.api.readImage(layersDirOf(file.pageDir), name),
          })
        } catch (err) {
          return stop(written, `${file.filename}:${messageOf(err)}`)
        }

        for (const profile of profiles) {
          if (abandoned) return stop(written, '已取消')
          const folder = profileFolderName(profile)
          try {
            const bytes = encodePage(page, profile)
            await window.api.writeExport(
              root,
              folder,
              outputFilename(profile, file.filename, index),
              bytes,
            )
          } catch (err) {
            return stop(written, `${file.filename} → ${folder}/:${messageOf(err)}`)
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
