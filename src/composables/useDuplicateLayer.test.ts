import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { blankBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import { projectionOf, shownLinesOf } from '@shared/page/units'
import { isLocked } from '@shared/page/tree'
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

type Project = ReturnType<typeof useProjectStore>

const page = (project: Project) => project.pageById(PAGE)!.page

const unit = (project: Project) => page(project).translationUnits[0]

const lettering = (project: Project) => unit(project).translation.members

/** The translation the copy made: the one that is not `u`. */
const twin = (project: Project) => page(project).translationUnits.find((u) => u.id !== 'u')!

/** The block the menu's copy of `t` is, in the second translation. */
const twinOfT = (project: Project) => twin(project).translation.members[0]

/** The block Ctrl+J made of `t`: the one after it in its own translation. */
const copyOfT = (project: Project) => lettering(project).find((id) => id !== 't')!

beforeEach(() => setActivePinia(createPinia()))

/**
 * ⭐ Ctrl+J and Alt with a drag copy the block pressed and nothing else: another
 * block of the same translation, read right after it, saying the same words.
 */
describe('copying a block of lettering', () => {
  it('joins its own translation, right after the block it copies', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(page(project).translationUnits).toHaveLength(1)
    expect(lettering(project)).toEqual(['t', copyOfT(project)])
    expect(unit(project).translation.separators).toEqual([''])
    expect(page(project).readingOrder).toEqual(['u'])
  })

  it('says the same words, its own lines when nothing is chosen', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(shownLinesOf(page(project), project.blockById(PAGE, copyOfT(project))!)).toEqual(['轟隆'])
  })

  it('says the same words when they come from a chosen proposal, which stays chosen', async () => {
    const { project, merge } = open([])
    unit(project).candidates = [{ id: 'c', pieces: [['好痛！']] }]
    unit(project).chosen = 'c'

    await merge.duplicateLayer()

    expect(unit(project).chosen).toBe('c')
    expect(shownLinesOf(page(project), project.blockById(PAGE, copyOfT(project))!)).toEqual(['好痛！'])
    expect(shownLinesOf(page(project), project.blockById(PAGE, 't')!)).toEqual(['好痛！'])
  })

  it('takes the block and its piece back out when undone, and puts them back on redo', async () => {
    const { project, editor, merge } = open([])
    unit(project).candidates = [{ id: 'c', pieces: [['好痛！']] }]
    unit(project).chosen = 'c'

    await merge.duplicateLayer()
    const made = JSON.parse(JSON.stringify(unit(project)))
    editor.undo()

    expect(lettering(project)).toEqual(['t'])
    expect(unit(project).candidates[0]!.pieces).toEqual([['好痛！']])
    expect(unit(project).translation.separators).toEqual([])

    editor.redo()
    expect(unit(project)).toEqual(made)
  })
})

/**
 * ⭐ The object menu's copy is a second translation, whole: both sides, its own
 * proposals, read right after the one it came from.
 */
describe('copying a whole translation', () => {
  it('makes a second translation, read right after the original', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    expect(page(project).translationUnits).toHaveLength(2)
    expect(page(project).readingOrder).toEqual(['u', twin(project).id])
    expect(lettering(project)).toEqual(['t'])
  })

  /** Half a translation is a row the list cannot draw. */
  it('copies the artwork side along with it', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    const [source] = twin(project).source.members
    expect(source).not.toBe('s')
    expect(project.blockById(PAGE, source!)?.side).toBe('source')
  })

  it('leaves no block the page cannot say anything about', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    const claimed = new Set(
      page(project).translationUnits.flatMap((u) => [...u.source.members, ...u.translation.members]),
    )
    for (const layer of page(project).layers) {
      expect(claimed.has(layer.id)).toBe(true)
    }
  })

  /**
   * ⚠️ The fault this pins. The words a chosen proposal gives live on the
   * translation, not the block, so copying the block alone left a copy that
   * said nothing.
   */
  it('says what the original says when its words come from a chosen proposal', async () => {
    const { project, merge } = open([])
    unit(project).candidates = [{ id: 'c', pieces: [['好痛！']] }]
    unit(project).chosen = 'c'

    await merge.duplicateLayer({ wholeUnit: true })

    const copy = project.blockById(PAGE, twinOfT(project))!
    expect(shownLinesOf(page(project), copy)).toEqual(['好痛！'])
    expect(twin(project).chosen).not.toBe('c')
  })

  it('gives it proposals of its own, so retyping one leaves the other alone', async () => {
    const { project, merge } = open([])
    unit(project).candidates = [{ id: 'c', pieces: [['好痛！']] }]
    unit(project).chosen = 'c'

    await merge.duplicateLayer({ wholeUnit: true })
    project.updateLabelText(PAGE, twinOfT(project), '不痛')

    expect(shownLinesOf(page(project), project.blockById(PAGE, 't')!)).toEqual(['好痛！'])
  })

  it('takes the whole second translation back out when it is undone', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    editor.undo()

    expect(page(project).translationUnits.map((u) => u.id)).toEqual(['u'])
    expect(page(project).readingOrder).toEqual(['u'])
    expect(page(project).layers.map((l) => l.id)).toEqual(['t', 's'])
  })

  it('puts it back the same on redo', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    const made = JSON.parse(JSON.stringify(twin(project)))
    editor.undo()
    editor.redo()

    expect(twin(project)).toEqual(made)
    expect(page(project).readingOrder).toEqual(['u', made.id])
  })

  /**
   * ⚠️ What a shallow copy costs: two entries handed one body are one object
   * wearing two ids, and dragging either moves both.
   */
  it('gives the copy a body of its own, so moving it leaves the original where it was', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    project.moveLabel(PAGE, twinOfT(project), 900, 40)

    expect(project.blockById(PAGE, twinOfT(project))!.body).toMatchObject({ x: 900, y: 40 })
    expect(project.blockById(PAGE, 't')!.body).toMatchObject({ x: 0, y: 0 })
  })

  it('gives it a style of its own, so restyling one leaves the other alone', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    const copy = twinOfT(project)
    project.setLabelStyle(PAGE, copy, { ...project.blockById(PAGE, copy)!.body.style, fontSizePx: 96 })

    expect(project.blockById(PAGE, 't')!.body.style.fontSizePx).not.toBe(96)
  })

  /** The artwork's own words copy the same way: a second translation, artwork first. */
  it('copies a whole translation from its source block too', async () => {
    const { project, editor, merge } = open(['轟隆'])
    editor.selectOnly('s')

    await merge.duplicateLayer({ wholeUnit: true })

    expect(unit(project).source.members).toEqual(['s'])
    expect(twin(project).translation.members).toHaveLength(1)
  })
})

/**
 * ⭐ What being a row rather than a decoration is for. The blocks are the order
 * the side is read in, so dragging one changes what the page says — which is
 * why it is a step of history and not a write through.
 */
describe('dragging one block of a translation set in two', () => {
  function two(first: string, second: string) {
    const opened = open([first])
    const extra = blankBlock('t2', 'translation', DEFAULT_TEXT_STYLE)
    extra.body.lines = [second]
    page(opened.project).layers.unshift(extra)
    unit(opened.project).translation = { members: ['t', 't2'], separators: [''] }
    return opened
  }

  it('reads the side in the order the blocks were left in', () => {
    const { project, editor } = two('轟', '隆')

    editor.cmdReorderMembers(PAGE, 'u', 'translation', ['t2', 't'])

    expect(projectionOf(page(project).layers, unit(project), 'translation')).toBe('隆轟')
  })

  it('is one step of history', () => {
    const { project, editor } = two('轟', '隆')

    editor.cmdReorderMembers(PAGE, 'u', 'translation', ['t2', 't'])
    editor.undo()

    expect(lettering(project)).toEqual(['t', 't2'])
  })

  it('records nothing for an order that is already the one it holds', () => {
    const { editor } = two('轟', '隆')
    const depth = editor.canUndo

    editor.cmdReorderMembers(PAGE, 'u', 'translation', ['t', 't2'])

    expect(editor.canUndo).toBe(depth)
  })

  /** ⚠️ A reorder that also added or dropped one would be losing lettering. */
  it('refuses a list that is not the blocks the side holds', () => {
    const { project } = two('轟', '隆')

    expect(project.reorderMembers(PAGE, 'u', 'translation', ['t'])).toBe(false)
    expect(project.reorderMembers(PAGE, 'u', 'translation', ['t', 't'])).toBe(false)
    expect(project.reorderMembers(PAGE, 'u', 'translation', ['t', 'stray'])).toBe(false)
    expect(lettering(project)).toEqual(['t', 't2'])
  })

  /** A seam is a fact about the seam, so only the order moves. */
  it('leaves the gap between the blocks where it was written', () => {
    const { project } = two('轟', '隆')
    unit(project).translation.separators = ['／']

    project.reorderMembers(PAGE, 'u', 'translation', ['t2', 't'])

    expect(unit(project).translation.separators).toEqual(['／'])
  })
})

describe('copying a locked layer', () => {
  it('makes a copy that is not locked, and leaves the original locked', async () => {
    const { project, merge } = open(['轟隆'])
    project.entryById('t')!.locked = true

    await merge.duplicateLayer()

    expect(project.entryById(copyOfT(project))?.locked).toBe(false)
    expect(project.entryById('t')?.locked).toBe(true)
  })

  function folded(locks: { folder: boolean; child: boolean }) {
    const page = useProjectStore().pageById(PAGE)!.page
    page.layers[0] = {
      kind: 'group',
      id: 'g',
      name: 'g',
      visible: true,
      locked: locks.folder,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      children: [{ ...page.layers[0], locked: locks.child }],
    }
    return page
  }

  it('keeps a locked folder locked in its copy, with everything inside it', async () => {
    const { project, editor, merge } = open(['轟隆'])
    const layers = folded({ folder: true, child: false })
    editor.selectOnly('g')

    await merge.duplicateLayer()

    expect(layers.layers[1].locked).toBe(true)
    expect(isLocked(layers.layers, copyOfT(project))).toBe(true)
  })

  it('keeps a locked layer locked when its unlocked folder is what gets copied', async () => {
    const { project, editor, merge } = open(['轟隆'])
    folded({ folder: false, child: true })
    editor.selectOnly('g')

    await merge.duplicateLayer()

    expect(project.entryById(copyOfT(project))?.locked).toBe(true)
  })

  it('unlocks a locked layer copied inside a locked folder, which still locks it from above', async () => {
    const { project, merge } = open(['轟隆'])
    const layers = folded({ folder: true, child: true })

    await merge.duplicateLayer()

    const copy = copyOfT(project)
    expect(project.entryById(copy)?.locked).toBe(false)
    expect(isLocked(layers.layers, copy)).toBe(true)
  })
})
