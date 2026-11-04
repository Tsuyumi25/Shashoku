import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { baseMapLayer, blankSourceBlock, blankTranslationBlock, defaultManifest } from './schema'
import type { GroupLayerEntry, LayerEntry, ManifestJson, RasterLayerEntry } from './types'
import {
  everyEntry,
  faceTree,
  linkToPage,
  removeFromPage,
  resolveTrees,
  settleTrees,
  snapshotTrees,
  unlinkToFace,
} from './trees'

const F1 = 'f1'
const F2 = 'f2'

function raster(id: string): RasterLayerEntry {
  return { ...baseMapLayer(`${id}.png`, 10, 10), id, name: id, locked: false }
}

function folder(id: string, children: LayerEntry[]): GroupLayerEntry {
  return { kind: 'group', id, name: id, visible: true, locked: false, opacity: 1, blendMode: 'pass-through', effects: [], children }
}

/** A base map and a source block on the page; f1 has its own BOOM above them, f2 nothing of its own. */
function page(): { m: ManifestJson; base: RasterLayerEntry; boom: RasterLayerEntry } {
  const m = defaultManifest('p', 10, 10)
  const base = raster('base')
  const words = blankSourceBlock('s1', DEFAULT_TEXT_STYLE)
  const boom = raster('boom')
  m.pageTree = [base, words]
  m.faceTrees = { [F1]: [base, words, boom], [F2]: [base, words] }
  return { m, base, boom }
}

const ids = (tree: readonly LayerEntry[]) => tree.map((e) => e.id)

describe('linking a layer to the page', () => {
  it('keeps it where it stands in its face and puts it on top of every other face', () => {
    const { m, boom } = page()
    m.faceTrees[F2]!.push(raster('own2'))
    expect(linkToPage(m, F1, 'boom')).toBe(true)
    expect(ids(faceTree(m, F1))).toEqual(['base', 's1', 'boom'])
    expect(ids(faceTree(m, F2))).toEqual(['base', 's1', 'own2', 'boom'])
    expect(faceTree(m, F2).at(-1)).toBe(boom)
    expect(m.pageTree).toContain(boom)
  })

  /** ⭐ Taken out of the shared box into one face, never copied into each: unlinking twice must not multiply it. */
  it('moves it back into the face it was unlinked in alone, at its place there', () => {
    const { m } = page()
    linkToPage(m, F1, 'boom')
    expect(unlinkToFace(m, F2, 'boom')).toBe(true)
    expect(ids(faceTree(m, F2))).toEqual(['base', 's1', 'boom'])
    expect(ids(faceTree(m, F1))).toEqual(['base', 's1'])
    expect(ids(m.pageTree)).toEqual(['base', 's1'])
    expect(everyEntry(m).filter((e) => e.id === 'boom')).toHaveLength(1)
  })

  it('refuses the words, which are the page’s or a face’s by what they are', () => {
    const { m } = page()
    const lettering = blankTranslationBlock('t1', F1, DEFAULT_TEXT_STYLE)
    m.faceTrees[F1]!.push(lettering)
    expect(linkToPage(m, F1, 't1')).toBe(false)
    expect(unlinkToFace(m, F1, 's1')).toBe(false)
  })
})

describe('taking an entry off the page', () => {
  /** ⭐ Tidying a face's own folders never takes a page material from anyone: what goes is the face's own. */
  it('leaves the page materials a deleted face folder held standing where it stood', () => {
    const { m, base } = page()
    const own = raster('own')
    m.faceTrees[F1] = [folder('box', [base, own]), ...m.faceTrees[F1]!.slice(1)]
    removeFromPage(m, 'box')
    expect(ids(faceTree(m, F1))).toEqual(['base', 's1', 'boom'])
    expect(faceTree(m, F1)[0]).toBe(base)
    expect(ids(m.pageTree)).toEqual(['base', 's1'])
    expect(ids(faceTree(m, F2))).toEqual(['base', 's1'])
  })

  it('takes a page material removed by itself off the page and every face', () => {
    const { m, base } = page()
    m.faceTrees[F1] = [folder('box', [base]), ...m.faceTrees[F1]!.slice(1)]
    removeFromPage(m, 'base')
    expect(ids(m.pageTree)).toEqual(['s1'])
    expect(ids(faceTree(m, F2))).toEqual(['s1'])
    expect(ids(faceTree(m, F1))).toEqual(['box', 's1', 'boom'])
  })

  /** Reading a face the page has no tree for must not hand out the page's own array to write into. */
  it('reads a face it has no tree for without writing it or reaching the page', () => {
    const { m } = page()
    ;(faceTree(m, 'f3') as LayerEntry[]).push(raster('stray'))
    expect(m.faceTrees.f3).toBeUndefined()
    expect(ids(m.pageTree)).toEqual(['base', 's1'])
  })
})

describe('trees as data', () => {
  it('writes page entries as references and reads them back as the page’s own objects', () => {
    const { m } = page()
    const snap = snapshotTrees(m)
    expect(snap.faceTrees[F1]![0]).toEqual({ kind: 'ref', id: 'base' })
    const faces = resolveTrees(snap.pageTree, snap.faceTrees)
    expect(faces[F1]![0]).toBe(snap.pageTree[0])
    expect(faces[F2]![0]).toBe(snap.pageTree[0])
  })
})

describe('settling the trees', () => {
  it('gives every face every page entry, and takes away what is neither the page’s nor its own', () => {
    const { m, base } = page()
    m.faceTrees[F2] = [blankTranslationBlock('t1', F1, DEFAULT_TEXT_STYLE), base]
    m.faceTrees[F1]!.push(raster('stray'))
    m.faceTrees[F2].push(m.faceTrees[F1]!.at(-1)!)
    expect(settleTrees(m, [F1, F2, 'f3'])).toBe(true)
    expect(ids(faceTree(m, F2))).toEqual(['base', 's1'])
    expect(ids(faceTree(m, F1))).toEqual(['base', 's1', 'boom', 'stray'])
    expect(ids(faceTree(m, 'f3'))).toEqual(['base', 's1'])
    expect(settleTrees(m, [F1, F2, 'f3'])).toBe(false)
  })
})
