import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { emptyCounters } from '@shared/page/numbers'
import { treesFromOneTree } from '@shared/page/schema'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { OcrCandidatePersisted } from '@shared/page/types'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const PAGE = 'p1'
const FACE = 'f'

const reading = (hash: string): OcrCandidatePersisted => ({
  hash,
  source: 'manga-ocr',
  text: 'あーあ',
  original: 'あーあ',
  x: 10,
  y: 10,
  w: 30,
  h: 60,
  confidence: 0.9,
  label: 'text_bubble',
})

function open() {
  const project = useProjectStore()
  project.projectMeta.faces = [{ id: FACE, no: 1, name: '譯文' }]
  project.projectMeta.activeFace = FACE
  project.allFiles = [
    {
      pageId: PAGE,
      pageDir: `/x/${PAGE}`,
      ocr: {
        schemaVersion: OCR_SCHEMA_VERSION,
        width: 100,
        height: 100,
        candidates: ['a', 'b', 'c', 'd'].map(reading),
      },
      badge: 'ok',
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 100,
        height: 100,
        ledgers: { [FACE]: { units: [] } },
        readingOrder: [],
        readingEdges: [],
        counters: emptyCounters(),
        ...treesFromOneTree([], [FACE], FACE),
      },
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE
  return { project, editor }
}

const aside = (project: ReturnType<typeof useProjectStore>) =>
  project
    .readingsOfPage(PAGE)
    .filter((r) => r.setAside)
    .map((r) => r.hash)

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('cmdSetReadingsAside', () => {
  /**
   * ⭐ Undoing one dismissal takes back what that dismissal did and nothing
   * more: readings an earlier one set aside stay set aside.
   */
  it('undoes only the readings that step set aside', () => {
    const { project, editor } = open()
    editor.cmdSetReadingsAside(PAGE, ['a', 'b'], true)
    editor.cmdSetReadingsAside(PAGE, ['a', 'b', 'c', 'd'], true)
    expect(aside(project)).toEqual(['a', 'b', 'c', 'd'])
    editor.undo()
    expect(aside(project)).toEqual(['a', 'b'])
    editor.undo()
    expect(aside(project)).toEqual([])
  })
})
