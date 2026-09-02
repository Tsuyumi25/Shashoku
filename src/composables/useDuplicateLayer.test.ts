import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { blankBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import { projectionOf } from '@shared/page/units'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useMergeLayers } from '@/composables/useMergeLayers'

const PAGE = 'p001.png'

/** One ordinary balloon: a block a side, and the translation over them. */
function open(words: string[]) {
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
            candidates: [],
            chosen: null,
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
  editor.selectOnly('t')
  return { project, editor, merge: useMergeLayers() }
}

const unit = (project: ReturnType<typeof useProjectStore>) =>
  project.pageById(PAGE)!.page.translationUnits[0]

const lettering = (project: ReturnType<typeof useProjectStore>) =>
  unit(project).translation.members

beforeEach(() => setActivePinia(createPinia()))

/**
 * ⭐ The one way there is, today, to end up with a translation set in more than
 * one block — so what it does with the copy is what says whether the unit
 * exists at all outside the schema.
 */
describe('copying a block of lettering', () => {
  it('puts the copy in the same translation, right after the one it came from', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(lettering(project)).toHaveLength(2)
    expect(lettering(project)[0]).toBe('t')
  })

  /**
   * ⚠️ The fault this pins. A copy that joined no translation would be drawn on
   * top of its original, absent from the label list, and named by nothing — so
   * the whole act would read as having done nothing at all.
   */
  it('leaves no block the page cannot say anything about', () => {
    const { project, merge } = open(['轟隆'])

    void merge.duplicateLayer()

    const claimed = new Set(
      unit(project).source.members.concat(unit(project).translation.members),
    )
    for (const layer of project.pageById(PAGE)!.page.layers) {
      expect(claimed.has(layer.id)).toBe(true)
    }
  })

  /** One piece of content, however many pieces of lettering say it. */
  it('does not make the page have one more thing to read', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(project.pageById(PAGE)!.page.readingOrder).toEqual(['u'])
    expect(project.pageById(PAGE)!.page.translationUnits).toHaveLength(1)
  })

  /** The copy says what the original says, so the row reads it twice over. */
  it('reads as both blocks, with nothing between them', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    const page = project.pageById(PAGE)!.page
    expect(projectionOf(page.layers, unit(project), 'translation')).toBe('轟隆轟隆')
  })

  it('takes the copy back out of the translation when it is undone', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer()
    editor.undo()

    expect(lettering(project)).toEqual(['t'])
    expect(project.pageById(PAGE)!.page.layers.map((l) => l.id)).toEqual(['t', 's'])
  })

  it('puts it back in the same place on redo', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer()
    const copy = lettering(project)[1]
    editor.undo()
    editor.redo()

    expect(lettering(project)).toEqual(['t', copy])
  })

  /**
   * ⚠️ What a shallow copy costs, and it is the whole feature: two entries
   * handed one body are one object wearing two ids. Dragging either moves both,
   * so the page looks exactly as it did and the act reads as having failed.
   */
  it('gives the copy a body of its own, so moving it leaves the original where it was', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()
    const copy = lettering(project)[1]
    project.moveLabel(PAGE, copy, 900, 40)

    expect(project.blockById(PAGE, copy)!.body).toMatchObject({ x: 900, y: 40 })
    expect(project.blockById(PAGE, 't')!.body).toMatchObject({ x: 0, y: 0 })
  })

  it('gives it words of its own, so retyping one leaves the other alone', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()
    project.updateLabelText(PAGE, lettering(project)[1], '隆')

    expect(project.blockById(PAGE, 't')!.body.lines).toEqual(['轟隆'])
  })

  it('gives it a style of its own, so restyling one leaves the other alone', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()
    const copy = lettering(project)[1]
    project.setLabelStyle(PAGE, copy, { ...project.blockById(PAGE, copy)!.body.style, fontSizePx: 96 })

    expect(project.blockById(PAGE, 't')!.body.style.fontSizePx).not.toBe(96)
  })

  /**
   * ⭐ What being a row rather than a decoration is for. The blocks are the
   * order the side is read in, so dragging one changes what the page says —
   * which is why it is a step of history and not a write through.
   */
  describe('and then dragging one of the blocks', () => {
    it('reads the side in the order the blocks were left in', async () => {
      const { project, editor, merge } = open(['轟'])
      await merge.duplicateLayer()
      const copy = lettering(project)[1]
      project.updateLabelText(PAGE, copy, '隆')

      editor.cmdReorderMembers(PAGE, 'u', 'translation', [copy, 't'])

      const page = project.pageById(PAGE)!.page
      expect(projectionOf(page.layers, unit(project), 'translation')).toBe('隆轟')
    })

    it('is one step of history', async () => {
      const { project, editor, merge } = open(['轟隆'])
      await merge.duplicateLayer()
      const copy = lettering(project)[1]

      editor.cmdReorderMembers(PAGE, 'u', 'translation', [copy, 't'])
      editor.undo()

      expect(lettering(project)).toEqual(['t', copy])
    })

    it('records nothing for an order that is already the one it holds', async () => {
      const { project, editor, merge } = open(['轟隆'])
      await merge.duplicateLayer()
      const held = [...lettering(project)]
      const depth = editor.canUndo

      editor.cmdReorderMembers(PAGE, 'u', 'translation', held)

      expect(editor.canUndo).toBe(depth)
    })

    /** ⚠️ A reorder that also added or dropped one would be losing lettering. */
    it('refuses a list that is not the blocks the side holds', async () => {
      const { project, merge } = open(['轟隆'])
      await merge.duplicateLayer()
      const held = [...lettering(project)]

      expect(project.reorderMembers(PAGE, 'u', 'translation', [held[0]])).toBe(false)
      expect(project.reorderMembers(PAGE, 'u', 'translation', [held[0], held[0]])).toBe(false)
      expect(project.reorderMembers(PAGE, 'u', 'translation', [held[0], 'stray'])).toBe(false)
      expect(lettering(project)).toEqual(held)
    })

    /** A seam is a fact about the seam, so only the order moves. */
    it('leaves the gap between the blocks where it was written', async () => {
      const { project, merge } = open(['轟'])
      await merge.duplicateLayer()
      const [first, second] = lettering(project)
      unit(project).translation.separators = ['／']

      project.reorderMembers(PAGE, 'u', 'translation', [second, first])

      expect(unit(project).translation.separators).toEqual(['／'])
    })
  })

  /** The artwork's own words copy the same way, into the side they belong to. */
  it('keeps a copied source block on the source side', async () => {
    const { project, editor, merge } = open(['轟隆'])
    editor.selectOnly('s')

    await merge.duplicateLayer()

    expect(unit(project).source.members).toHaveLength(2)
    expect(unit(project).translation.members).toEqual(['t'])
  })
})
