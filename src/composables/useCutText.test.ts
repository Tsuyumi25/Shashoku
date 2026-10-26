import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { blankBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { TranslationCandidate } from '@shared/page/types'
import { projectionOf, shownLinesOf } from '@shared/page/units'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCutText } from '@/composables/useCutText'

// Where a piece lands is the engine's to say; what is pinned here is the words.
vi.mock('@/lib/labelRaster', () => ({
  drawnLabel: (_text: string, _style: unknown, _effects: unknown, at: { x: number; y: number }) => ({
    sample: null,
    missingFamily: null,
    box: { w: 100, h: 20 },
    center: at,
  }),
}))

const PAGE = 'p001.png'

function open(words: string[], candidates: TranslationCandidate[] = [], chosen: string | null = null) {
  const project = useProjectStore()
  const lettering = blankBlock('t', 'translation', DEFAULT_TEXT_STYLE)
  lettering.body.lines = words
  const artwork = blankBlock('s', 'source', DEFAULT_TEXT_STYLE)
  project.allFiles = [
    {
      pageId: PAGE,
      pageDir: `/x/${PAGE}`,
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      badge: 'ok',
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        translationUnits: [
          {
            id: 'u',
            tags: [],
            source: { members: ['s'], separators: [] },
            translation: { members: ['t'], separators: [] },
            candidates,
            chosen,
          },
        ],
        readingOrder: ['u'],
        readingEdges: [],
        layers: [lettering, artwork],
      },
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE
  return { project, editor, cut: useCutText() }
}

const page = (project: ReturnType<typeof useProjectStore>) => project.pageById(PAGE)!.page
const unit = (project: ReturnType<typeof useProjectStore>) => page(project).translationUnits[0]!
const reads = (project: ReturnType<typeof useProjectStore>) =>
  projectionOf(page(project).layers, unit(project), 'translation')
const shown = (project: ReturnType<typeof useProjectStore>) =>
  unit(project).translation.members.map((id) =>
    shownLinesOf(page(project), project.blockById(PAGE, id)!).join('\n'),
  )

beforeEach(() => setActivePinia(createPinia()))

describe('cutting a stretch of lettering into a block of its own', () => {
  it('splits the block in reading order and leaves the sentence reading the same', () => {
    const { project, cut } = open(['這句話都是分散的'])

    cut.cutSelection(PAGE, 't', 3, 5)

    expect(shown(project)).toEqual(['這句話', '都是', '分散的'])
    expect(reads(project)).toBe('這句話都是分散的')
  })

  it('selects the stretch that was cut, so a drag moves it', () => {
    const { project, editor, cut } = open(['好痛！'])

    cut.cutSelection(PAGE, 't', 2, 3)

    expect(editor.cursorId).toBe(unit(project).translation.members[1])
    expect(shown(project)).toEqual(['好痛', '！'])
  })

  it('keeps a line break at the cut between the blocks', () => {
    const { project, cut } = open(['第一行', '第二行'])

    cut.cutSelection(PAGE, 't', 4, 7)

    expect(shown(project)).toEqual(['第一行', '第二行'])
    expect(reads(project)).toBe('第一行\n第二行')
  })

  it('undoes to one block holding the whole sentence, and redoes to the same cut', () => {
    const { project, editor, cut } = open(['這句話都是分散的'])
    cut.cutSelection(PAGE, 't', 3, 5)
    const cutInto = [...unit(project).translation.members]

    editor.undo()
    expect(unit(project).translation.members).toEqual(['t'])
    expect(shown(project)).toEqual(['這句話都是分散的'])

    editor.redo()
    expect(unit(project).translation.members).toEqual(cutInto)
    expect(shown(project)).toEqual(['這句話', '都是', '分散的'])
  })

  /**
   * A chosen proposal is what the page reads, so it is what gets cut — and the
   * block's own words, a different translation, stay whole and come back when
   * the choice is cleared.
   */
  it('cuts the chosen proposal and keeps the block’s own words whole', () => {
    const { project, cut } = open(['自己打的'], [{ id: 'c', pieces: [['好痛啊！']] }], 'c')

    cut.cutSelection(PAGE, 't', 3, 4)

    expect(shown(project)).toEqual(['好痛啊', '！'])
    project.setLabelTranslation(PAGE, 'u', null)
    expect(reads(project)).toBe('自己打的')
  })
})
