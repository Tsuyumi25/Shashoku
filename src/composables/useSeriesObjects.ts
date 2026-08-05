import { ref } from 'vue'
import { parseManifest } from '@shared/page/schema'
import { textObjects } from '@shared/page/tree'
import { folderName, parentFolder } from '@shared/project/library'
import type { BucketObject } from '@/lib/valueBuckets'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Every text object in the other chapters of this series, read off disk.
 *
 * Loaded on demand and never watched. The open chapter is live because it is
 * the document; the rest are a reference the answer is measured against, and
 * keeping a file watcher on a whole series to catch an edit made in another
 * window is a great deal of machinery for a number in a sidebar. The reload
 * button is the honest version of that.
 *
 * A chapter that will not open is skipped rather than taking the whole count
 * down — a series with one damaged folder still has a useful answer for the
 * rest of it, and the count says how many chapters it actually read.
 */
export function useSeriesObjects() {
  const project = useProjectStore()

  const objects = ref<BucketObject[]>([])
  const chapters = ref(0)
  const skipped = ref<string[]>([])
  const loading = ref(false)
  const loadedFor = ref<string | null>(null)

  async function objectsOf(rootPath: string): Promise<BucketObject[]> {
    const opened = await window.api.openProject(rootPath)
    const out: BucketObject[] = []
    for (const page of opened.pages) {
      if (page.badge !== 'ok') continue
      const raw = await window.api.readPage(page.pageDir)
      for (const label of textObjects(parseManifest(raw.manifestRaw).layers)) {
        out.push({
          id: label.id,
          filename: `${folderName(rootPath)}/${page.filename}`,
          tags: label.tags,
          style: label.style,
        })
      }
    }
    return out
  }

  async function load(): Promise<void> {
    const root = project.rootPath
    if (root === null || loading.value) return
    loading.value = true
    const found: BucketObject[] = []
    const failed: string[] = []
    let read = 0
    try {
      const series = parentFolder(root)
      const scanned = await window.api.scanLibrary([series])
      const siblings = (scanned[0]?.projects ?? []).map((p) => p.path).filter((p) => p !== root)
      for (const sibling of siblings) {
        try {
          found.push(...(await objectsOf(sibling)))
          read++
        } catch {
          failed.push(folderName(sibling))
        }
      }
    } finally {
      objects.value = found
      chapters.value = read
      skipped.value = failed
      loadedFor.value = root
      loading.value = false
    }
  }

  return { objects, chapters, skipped, loading, loadedFor, load }
}
