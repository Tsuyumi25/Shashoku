import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { pageArtwork } from '@shared/page/tree'
import { layersDirOf } from '@shared/ssk/constants'
import type { ProjectFile } from '@/types/project'
import {
  inRenderSlot,
  layerImageKey,
  renderFitted,
  renderThumbnail,
  thumbnailKey,
} from '@/lib/pageThumbnail'
import { useProjectStore } from '@/stores/projectStore'

export type PageThumbnailSubject = 'composite' | 'artwork'

export function usePageThumbnail(
  cell: Ref<HTMLElement | null>,
  file: () => ProjectFile,
  subject: PageThumbnailSubject = 'composite',
): { src: Ref<string | null>; problem: Ref<string | null> } {
  const project = useProjectStore()

  const src = ref<string | null>(null)
  const problem = ref<string | null>(null)
  const seen = ref(false)

  useIntersectionObserver(
    cell,
    ([entry]) => {
      if (entry.isIntersecting) seen.value = true
    },
    { rootMargin: '400px' },
  )

  let url: string | null = null
  /** Which load the pending work belongs to, so a stale one cannot land. */
  let generation = 0

  function revoke() {
    if (url) {
      URL.revokeObjectURL(url)
      url = null
    }
  }

  async function compositeBytes(of: ProjectFile): Promise<Uint8Array> {
    const key = await thumbnailKey(of)
    const cached = await window.api.readThumbnail(key)
    if (cached) return cached

    return inRenderSlot(async () => {
      const png = await renderThumbnail(of)
      // Failing to cache costs the next draw, not this one.
      void window.api.writeThumbnail(key, png).catch(() => {})
      return png
    })
  }

  async function artworkBytes(of: ProjectFile): Promise<Uint8Array | null> {
    const entry = pageArtwork(of.page.layers)
    if (entry === null) return null
    const dir = layersDirOf(of.pageDir)
    const key = await layerImageKey(dir, entry.file)
    const cached = await window.api.readThumbnail(key)
    if (cached) return cached

    return inRenderSlot(async () => {
      const png = await renderFitted(await window.api.readImage(dir, entry.file))
      void window.api.writeThumbnail(key, png).catch(() => {})
      return png
    })
  }

  async function bytesFor(of: ProjectFile): Promise<Uint8Array | null> {
    /*
     * Before the key, not just before the drawing. Both subjects read `layers/`,
     * and the newest paint may be in memory alone — a thumbnail of the page as it
     * was half a minute ago is exactly the wrong answer to "did page 47 get
     * typeset". The key is taken from the manifest, so settling first is also what
     * keeps a stale picture from being filed under a name that looks current.
     *
     * Costs nothing when nothing is owed, which is every thumbnail but the few
     * after an edit.
     */
    await project.flush()
    return subject === 'artwork' ? artworkBytes(of) : compositeBytes(of)
  }

  async function load() {
    const mine = ++generation
    revoke()
    src.value = null
    problem.value = null
    const of = file()
    if (!seen.value || of.badge !== 'ok' || !project.rootPath) return
    try {
      const bytes = await bytesFor(of)
      if (mine !== generation || bytes === null) return
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
      src.value = url
    } catch (err) {
      if (mine !== generation) return
      problem.value = err instanceof Error ? err.message : String(err)
    }
  }

  watch(() => [seen.value, file().pageDir, project.rootPath] as const, () => void load(), {
    immediate: true,
  })

  onBeforeUnmount(() => {
    generation++
    revoke()
  })

  return { src, problem }
}
