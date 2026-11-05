import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defaultExportProfile } from '@shared/export/types'
import { useProjectStore } from '@/stores/projectStore'

const PNG = defaultExportProfile()

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a delivery on the export menu', () => {
  /** Copied in without a face, or with one since deleted, it keeps naming the folder it went to. */
  it('pins a line to the face it was delivered to', () => {
    const project = useProjectStore()
    const id = project.addExportEntry({ ...PNG, face: 'gone' })
    project.markExported(id, 'zh', 5)
    expect(project.exportMenu.map((e) => [e.profile.face, e.exportedAt])).toEqual([['zh', 5]])
  })

  it('leaves the other lines alone', () => {
    const project = useProjectStore()
    const a = project.addExportEntry(PNG)
    const b = project.addExportEntry(PNG)
    project.markExported(b, 'zh', 5)
    expect(project.exportMenu.find((e) => e.id === a)).toEqual({ id: a, profile: PNG, exportedAt: null })
  })
})
