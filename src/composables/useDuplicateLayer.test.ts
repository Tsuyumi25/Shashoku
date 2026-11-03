import { beforeEach, describe, expect, it } from 'vitest'
import { toRaw } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { emptyCounters } from '@shared/page/numbers'
import { blankSourceBlock, blankTranslationBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { TranslationTextLayerEntry } from '@shared/page/types'
import { facePage, projectionOf, shownLinesOf } from '@shared/page/units'
import { isLocked } from '@shared/page/tree'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useMergeLayers } from '@/composables/useMergeLayers'

const PAGE = 'p001.png'
const FACE = 'f'

/** One ordinary balloon: a block a side, and the sentence over them. */
function open(words: string[]) {
  const project = useProjectStore()
  project.projectMeta.faces = [{ id: FACE, no: 1, name: '譯文' }]
  project.projectMeta.activeFace = FACE
  const lettering = blankTranslationBlock('t', FACE, DEFAULT_TEXT_STYLE)
  lettering.body.lines = words
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
  editor.selectOnly('t')
  return { project, editor, merge: useMergeLayers() }
}

type Project = ReturnType<typeof useProjectStore>

const page = (project: Project) => project.pageById(PAGE)!.page

const view = (project: Project) => facePage(page(project), FACE)

const unit = (project: Project) => view(project).units[0]!

const blocksOfSide = (project: Project, unitId: string, side: 'source' | 'translation') =>
  view(project)
    .units.find((u) => u.id === unitId)!
    .members.filter((id) => project.blockById(PAGE, id)?.side === side)

const lettering = (project: Project) => blocksOfSide(project, 'u', 'translation')

/** The sentence the copy made: the one that is not `u`. */
const twin = (project: Project) => view(project).units.find((u) => u.id !== 'u')!

/** The block the menu's copy of `t` is, in the second sentence. */
const twinOfT = (project: Project) => blocksOfSide(project, twin(project).id, 'translation')[0]!

/** The block Ctrl+J made of `t`: the one after it in its own sentence. */
const copyOfT = (project: Project) => lettering(project).find((id) => id !== 't')!

const letteringBlock = (project: Project, id: string) =>
  project.blockById(PAGE, id) as TranslationTextLayerEntry

/** The one block of lettering the sentence has, given a drawer and a pick. */
function proposed(project: Project, lines: string[]) {
  const block = letteringBlock(project, 't')
  block.body.candidates = [{ id: 'c', lines }]
  block.body.chosen = 'c'
}

beforeEach(() => setActivePinia(createPinia()))

/**
 * ⭐ Ctrl+J and Alt with a drag copy the block pressed and nothing else: another
 * block of the same sentence, read right after it, saying the same words.
 */
describe('copying a block of lettering', () => {
  it('joins its own sentence, right after the block it copies', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(view(project).units).toHaveLength(1)
    expect(unit(project).members).toEqual(['s', 't', copyOfT(project)])
    expect(view(project).readingOrder).toEqual(['u'])
  })

  it('says the same words, its own lines when nothing is chosen', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer()

    expect(shownLinesOf(letteringBlock(project, copyOfT(project)))).toEqual(['轟隆'])
  })

  /**
   * ⚠️ The drawer stays with the block it was proposed for. The copy says the
   * same words because they were written into its own lines, not because it
   * holds a second copy of somebody's proposal.
   */
  it('takes the words a chosen proposal gives but none of the drawer', async () => {
    const { project, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer()

    const copy = letteringBlock(project, copyOfT(project))
    expect(copy.body.lines).toEqual(['好痛！'])
    expect(copy.body.candidates).toEqual([])
    expect(copy.body.chosen).toBeNull()
  })

  it('leaves the block it copied reading what it read', async () => {
    const { project, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer()

    expect(letteringBlock(project, 't').body.chosen).toBe('c')
    expect(shownLinesOf(letteringBlock(project, 't'))).toEqual(['好痛！'])
  })

  it('takes the block back out when undone, and puts it back on redo', async () => {
    const { project, editor, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer()
    const made = structuredClone(toRaw(unit(project)))
    editor.undo()

    expect(lettering(project)).toEqual(['t'])
    expect(letteringBlock(project, 't').body.candidates).toEqual([{ id: 'c', lines: ['好痛！'] }])

    editor.redo()
    expect(unit(project)).toEqual(made)
  })
})

/**
 * ⭐ The object menu's copy is a second sentence, whole: both sides, its own
 * proposals, read right after the one it came from.
 */
describe('copying a whole sentence', () => {
  it('makes a second sentence, read right after the original', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    expect(view(project).units).toHaveLength(2)
    expect(view(project).readingOrder).toEqual(['u', twin(project).id])
    expect(lettering(project)).toEqual(['t'])
  })

  /** Half a sentence is a row the list cannot draw. */
  it('copies the artwork side along with it', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    const [source] = blocksOfSide(project, twin(project).id, 'source')
    expect(source).not.toBe('s')
    expect(project.blockById(PAGE, source!)?.side).toBe('source')
  })

  it('leaves no block the page cannot say anything about', async () => {
    const { project, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })

    const claimed = new Set(view(project).units.flatMap((u) => u.members))
    for (const layer of page(project).layers) {
      expect(claimed.has(layer.id)).toBe(true)
    }
  })

  /**
   * ⚠️ The fault this pins. Copying the block alone used to leave a copy that
   * said nothing, back when the words a chosen proposal gives lived on the
   * sentence rather than on the block.
   */
  it('says what the original says when its words come from a chosen proposal', async () => {
    const { project, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer({ wholeUnit: true })

    expect(shownLinesOf(letteringBlock(project, twinOfT(project)))).toEqual(['好痛！'])
  })

  /**
   * ⭐ The drawer comes too, under ids of its own, and the pick follows them.
   * Two blocks sharing a candidate id would be one proposal withdrawn twice.
   */
  it('brings the drawer over under fresh ids, with the pick remapped onto them', async () => {
    const { project, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer({ wholeUnit: true })
    const copy = letteringBlock(project, twinOfT(project))

    expect(copy.body.candidates.map((c) => c.lines)).toEqual([['好痛！']])
    expect(copy.body.candidates[0]!.id).not.toBe('c')
    expect(copy.body.chosen).toBe(copy.body.candidates[0]!.id)
  })

  it('gives it proposals of its own, so retyping one leaves the other alone', async () => {
    const { project, merge } = open([])
    proposed(project, ['好痛！'])

    await merge.duplicateLayer({ wholeUnit: true })
    project.updateLabelText(PAGE, twinOfT(project), '不痛')

    expect(shownLinesOf(letteringBlock(project, 't'))).toEqual(['好痛！'])
  })

  it('takes the whole second sentence back out when it is undone', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    editor.undo()

    expect(view(project).units.map((u) => u.id)).toEqual(['u'])
    expect(view(project).readingOrder).toEqual(['u'])
    expect(page(project).layers.map((l) => l.id)).toEqual(['t', 's'])
  })

  it('puts it back the same on redo', async () => {
    const { project, editor, merge } = open(['轟隆'])

    await merge.duplicateLayer({ wholeUnit: true })
    const made = structuredClone(toRaw(twin(project)))
    editor.undo()
    editor.redo()

    expect(twin(project)).toEqual(made)
    expect(view(project).readingOrder).toEqual(['u', made.id])
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

  /** The artwork's own words copy the same way: a second sentence, artwork first. */
  it('copies a whole sentence from its source block too', async () => {
    const { project, editor, merge } = open(['轟隆'])
    editor.selectOnly('s')

    await merge.duplicateLayer({ wholeUnit: true })

    expect(blocksOfSide(project, 'u', 'source')).toEqual(['s'])
    expect(blocksOfSide(project, twin(project).id, 'translation')).toHaveLength(1)
  })
})

/**
 * ⭐ What being a row rather than a decoration is for. The blocks are the order
 * the side is read in, so dragging one changes what the page says — which is
 * why it is a step of history and not a write through.
 */
describe('dragging one block of a sentence set in two', () => {
  function two(first: string, second: string) {
    const opened = open([first])
    const extra = blankTranslationBlock('t2', FACE, DEFAULT_TEXT_STYLE)
    extra.body.lines = [second]
    page(opened.project).layers.unshift(extra)
    unit(opened.project).members = ['s', 't', 't2']
    return opened
  }

  it('reads the side in the order the blocks were left in', () => {
    const { project, editor } = two('轟', '隆')

    editor.cmdReorderMembers(PAGE, 'u', 'translation', ['t2', 't'])

    expect(projectionOf(view(project), unit(project), 'translation')).toBe('隆/轟')
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

  /** ⚠️ The artwork's words are not this side's to move, however the list reads. */
  it('leaves the other side where it is', () => {
    const { project } = two('轟', '隆')

    project.reorderMembers(PAGE, 'u', 'translation', ['t2', 't'])

    expect(unit(project).members).toEqual(['s', 't2', 't'])
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
      children: [{ ...toRaw(page.layers[0]), locked: locks.child }],
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
