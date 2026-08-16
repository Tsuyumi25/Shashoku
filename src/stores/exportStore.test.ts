import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useExportStore } from './exportStore'
import { useProjectStore } from './projectStore'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import type { ProjectFile } from '@/types/project'

function page(pageId: string): ProjectFile {
  return {
    pageId,
    pageDir: `/root/shashoku/pages/${pageId}`,
    page: defaultManifest(pageId, 1200, 1700),
    ocr: defaultOcr(1200, 1700),
    badge: 'ok',
  }
}

describe('what an export would cover', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('covers the whole of a project that was just opened', async () => {
    const project = useProjectStore()
    const exportSelection = useExportStore()

    project.files = [page('a'), page('b'), page('c')]
    await nextTick()

    expect(exportSelection.allSelected).toBe(true)
  })

  // Making pages replaces the list wholesale, exactly as opening a project
  // does, so anything keyed off "the list changed" cannot tell them apart. What
  // it can tell apart is which pages it has already had an answer about.
  it('leaves a page that was deliberately left out alone when more pages arrive', async () => {
    const project = useProjectStore()
    const exportSelection = useExportStore()

    project.files = [page('a'), page('b'), page('c')]
    await nextTick()
    exportSelection.toggle('b')
    expect(exportSelection.isSelected('b')).toBe(false)

    project.files = [page('a'), page('b'), page('c'), page('d')]
    await nextTick()

    expect(exportSelection.isSelected('b')).toBe(false)
    expect(exportSelection.isSelected('d')).toBe(true)
    expect(exportSelection.isSelected('a')).toBe(true)
  })

  it('delivers all of another project, whatever was picked in this one', async () => {
    const project = useProjectStore()
    const exportSelection = useExportStore()

    project.files = [page('a'), page('b')]
    await nextTick()
    exportSelection.toggle('a')

    project.files = [page('x'), page('y')]
    await nextTick()

    expect(exportSelection.allSelected).toBe(true)
  })
})
