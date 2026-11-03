import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { emptyCounters } from '@shared/page/numbers'
import { blankSourceBlock, blankTranslationBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { TranslationCandidate, TranslationTextLayerEntry } from '@shared/page/types'
import { facePage, projectionOf, shownCodeOf, shownLinesOf } from '@shared/page/units'
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
const FACE = 'f'

function open(words: string[], candidates: TranslationCandidate[] = [], chosen: string | null = null) {
  const project = useProjectStore()
  project.projectMeta.faces = [{ id: FACE, no: 1, name: '譯文' }]
  project.projectMeta.activeFace = FACE
  const lettering = blankTranslationBlock('t', FACE, DEFAULT_TEXT_STYLE)
  lettering.body.lines = words
  lettering.body.candidates = candidates
  lettering.body.chosen = chosen
  const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
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
        ledgers: {
          [FACE]: { units: [{ id: 'u', members: ['s', 't'] }], readingOrder: ['u'], readingEdges: [] },
        },
        counters: emptyCounters(),
        layers: [lettering, artwork],
      },
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE
  return { project, editor, cut: useCutText() }
}

type Project = ReturnType<typeof useProjectStore>

const view = (project: Project) => facePage(project.pageById(PAGE)!.page, FACE)

const unit = (project: Project) => view(project).units[0]!

const lettering = (project: Project) =>
  unit(project).members.filter((id) => project.blockById(PAGE, id)?.side === 'translation')

const reads = (project: Project) => projectionOf(view(project), unit(project), 'translation')

const shown = (project: Project) =>
  lettering(project).map((id) => shownLinesOf(project.blockById(PAGE, id)!).join('\n'))

const codes = (project: Project) =>
  lettering(project).map((id) => shownCodeOf(project.blockById(PAGE, id)!))

const letteringBlock = (project: Project, id: string) =>
  project.blockById(PAGE, id) as TranslationTextLayerEntry

beforeEach(() => setActivePinia(createPinia()))

describe('cutting a stretch of lettering into a block of its own', () => {
  it('splits the block in reading order and leaves the sentence reading the same', () => {
    const { project, cut } = open(['這句話都是分散的'])

    cut.cutSelection(PAGE, 't', 3, 5)

    expect(shown(project)).toEqual(['這句話', '都是', '分散的'])
    expect(reads(project)).toBe('這句話/都是/分散的')
  })

  it('selects the stretch that was cut, so a drag moves it', () => {
    const { project, editor, cut } = open(['好痛！'])

    cut.cutSelection(PAGE, 't', 2, 3)

    expect(editor.cursorId).toBe(lettering(project)[1])
    expect(shown(project)).toEqual(['好痛', '！'])
  })

  it('keeps a line break at the cut between the blocks', () => {
    const { project, cut } = open(['第一行', '第二行'])

    cut.cutSelection(PAGE, 't', 4, 7)

    expect(shown(project)).toEqual(['第一行', '第二行'])
  })

  it('undoes to one block holding the whole sentence, and redoes to the same cut', () => {
    const { project, editor, cut } = open(['這句話都是分散的'])
    cut.cutSelection(PAGE, 't', 3, 5)
    const cutInto = [...lettering(project)]

    editor.undo()
    expect(lettering(project)).toEqual(['t'])
    expect(shown(project)).toEqual(['這句話都是分散的'])

    editor.redo()
    expect(lettering(project)).toEqual(cutInto)
    expect(shown(project)).toEqual(['這句話', '都是', '分散的'])
  })

  /**
   * ⭐ A chosen proposal is what the page reads, so it is what gets cut: the
   * first piece is written back into that very proposal, and the pieces that
   * leave are their own words in blocks with nothing proposed for them.
   */
  it('writes the first piece into the proposal the block is reading', () => {
    const { project, cut } = open(['自己打的'], [{ id: 'c', lines: ['好痛啊！'] }], 'c')

    cut.cutSelection(PAGE, 't', 3, 4)

    expect(shown(project)).toEqual(['好痛啊', '！'])
    expect(letteringBlock(project, 't').body.candidates).toMatchObject([
      { id: 'c', lines: ['好痛啊'], human: true },
    ])
    expect(letteringBlock(project, 't').body.lines).toEqual(['自己打的'])
  })

  it('leaves the pieces that moved out with nothing proposed for them', () => {
    const { project, cut } = open(['自己打的'], [{ id: 'c', lines: ['好痛啊！'] }], 'c')

    cut.cutSelection(PAGE, 't', 3, 4)
    const moved = letteringBlock(project, lettering(project)[1]!)

    expect(moved.body.candidates).toEqual([])
    expect(moved.body.chosen).toBeNull()
    expect(moved.body.lines).toEqual(['！'])
  })

  /** The block's own words are a different translation and stay whole under it. */
  it('comes back to the block’s own words when the choice is cleared', () => {
    const { project, cut } = open(['自己打的'], [{ id: 'c', lines: ['好痛啊！'] }], 'c')

    cut.cutSelection(PAGE, 't', 3, 4)
    project.setLabelTranslation(PAGE, 't', null)

    expect(reads(project)).toBe('自己打的/！')
  })

  it('puts the cut proposal back whole when it is undone', () => {
    const { project, editor, cut } = open(['自己打的'], [{ id: 'c', lines: ['好痛啊！'] }], 'c')

    cut.cutSelection(PAGE, 't', 3, 4)
    editor.undo()

    expect(lettering(project)).toEqual(['t'])
    expect(letteringBlock(project, 't').body.candidates).toEqual([{ id: 'c', lines: ['好痛啊！'] }])
    expect(shown(project)).toEqual(['好痛啊！'])
  })

  /**
   * The selection counts what is on the page, and the markup sits between those
   * characters — cutting by the code's own offsets would slice a tag in half.
   */
  it('cuts by what is shown and sends each tag with the words it sets', () => {
    const { project, cut } = open(['大<size=×2>字</size>小'])

    cut.cutSelection(PAGE, 't', 1, 2)

    expect(shown(project)).toEqual(['大', '字', '小'])
    expect(codes(project)).toEqual(['大', '<size=×2>字</size>', '小'])
  })

  it('closes a tag the cut falls inside and opens it again on the other side', () => {
    const { project, cut } = open(['<size=×2>大字小</size>'])

    cut.cutSelection(PAGE, 't', 1, 2)

    expect(shown(project)).toEqual(['大', '字', '小'])
    expect(codes(project)).toEqual([
      '<size=×2>大</>',
      '<size=×2>字</>',
      '<size=×2>小</size>',
    ])
  })
})
