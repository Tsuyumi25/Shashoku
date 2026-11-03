import { describe, expect, it } from 'vitest'
import {
  applyPageOrderSnapshot,
  insertPagesAt,
  naturalOrderOf,
  pageDirName,
  pageNumberOf,
  reconcilePages,
  reorderPages,
} from './pages'

describe('pageDirName', () => {
  it('names the first page of a book p1', () => {
    expect(pageDirName([])).toBe('p1')
  })

  it('counts past the highest name taken', () => {
    expect(pageDirName(['p1', 'p2', 'p3'])).toBe('p4')
  })

  it('does not care what order the names come in', () => {
    expect(pageDirName(['p3', 'p1', 'p2'])).toBe('p4')
  })

  it('never fills a gap a deleted page left', () => {
    expect(pageDirName(['p1', 'p3'])).toBe('p4')
  })

  it('ignores names that are not page directories', () => {
    expect(pageDirName(['cover', 'p2', '001-260809-1430'])).toBe('p3')
  })

  it('counts neither p0 nor a padded number nor a capital P', () => {
    expect(pageDirName(['p0', 'p01', 'P3'])).toBe('p1')
  })
})

describe('pageNumberOf', () => {
  it('reads the number out of a page directory name', () => {
    expect(pageNumberOf('p7')).toBe(7)
    expect(pageNumberOf('p12')).toBe(12)
  })

  it('answers null for anything that is not one', () => {
    expect(pageNumberOf('p0')).toBeNull()
    expect(pageNumberOf('p01')).toBeNull()
    expect(pageNumberOf('P3')).toBeNull()
    expect(pageNumberOf('p')).toBeNull()
    expect(pageNumberOf('p3x')).toBeNull()
    expect(pageNumberOf('cover')).toBeNull()
  })
})

describe('reconcilePages', () => {
  it('keeps the order the list gives', () => {
    const out = reconcilePages(['c', 'a', 'b'], ['a', 'b', 'c'])
    expect(out.order).toEqual(['c', 'a', 'b'])
    expect(out.missing).toEqual([])
    expect(out.adopted).toEqual([])
  })

  /**
   * A directory nobody listed is a page — it has a manifest and pixels — so it
   * joins the end rather than being ignored. Crashes, half-finished syncs and
   * a user tidying their own disk all arrive here.
   */
  it('takes in a directory the list never mentioned, at the end', () => {
    const out = reconcilePages(['a'], ['a', 'z'])
    expect(out.order).toEqual(['a', 'z'])
    expect(out.adopted).toEqual(['z'])
  })

  it('adopts in the order the disk gives them', () => {
    const out = reconcilePages([], ['b', 'a'])
    expect(out.order).toEqual(['b', 'a'])
    expect(out.adopted).toEqual(['b', 'a'])
  })

  /**
   * Kept in the order rather than dropped: a list that quietly shortened itself
   * would be the program deciding a page is gone, which is the user's call.
   */
  it('keeps a listed page whose directory is not there, and says so', () => {
    const out = reconcilePages(['a', 'b'], ['a'])
    expect(out.order).toEqual(['a', 'b'])
    expect(out.missing).toEqual(['b'])
  })

  it('drops a repeat of a page the list already named', () => {
    const out = reconcilePages(['a', 'a', 'b'], ['a', 'b'])
    expect(out.order).toEqual(['a', 'b'])
  })

  /**
   * The undone import, one step on: its name never left `pages`, so the
   * directory it left on disk is not one "nobody listed". Taking the name out
   * instead would make rule ② adopt the page straight back, at the end of the
   * chapter rather than where it was dropped — an import already undone,
   * returned to a place the user never chose.
   */
  it('does not adopt a page whose name is still listed, however it is hidden', () => {
    expect(reconcilePages(['a', 'p', 'b'], ['a', 'p', 'b'])).toEqual({
      order: ['a', 'p', 'b'],
      missing: [],
      adopted: [],
    })
  })

  it('has nothing to say about an empty project', () => {
    expect(reconcilePages([], [])).toEqual({ order: [], missing: [], adopted: [] })
  })
})

describe('naturalOrderOf', () => {
  it('reads ids back in the order the list already holds them, not the order given', () => {
    expect(naturalOrderOf(['a', 'b', 'c', 'd'], ['d', 'a'])).toEqual(['a', 'd'])
  })
})

describe('insertPagesAt', () => {
  it('splices in at the front', () => {
    expect(insertPagesAt(['a', 'b'], [], ['x'], 0)).toEqual(['x', 'a', 'b'])
  })

  it('splices in at the end once the index reaches past the last visible page', () => {
    expect(insertPagesAt(['a', 'b'], [], ['x'], 2)).toEqual(['a', 'b', 'x'])
  })

  it('splices in the middle', () => {
    expect(insertPagesAt(['a', 'b', 'c'], [], ['x'], 1)).toEqual(['a', 'x', 'b', 'c'])
  })

  it('carries several new pages in as one connected run, in the order given', () => {
    expect(insertPagesAt(['a', 'b'], [], ['x', 'y'], 1)).toEqual(['a', 'x', 'y', 'b'])
  })

  it('never needs to exclude anything, since a new page was never in the list', () => {
    // Targeting the position a tombstoned page sits at does not collide with
    // it — the index is counted over the *visible* pages only.
    expect(insertPagesAt(['a', 'x', 'b'], ['x'], ['n'], 1)).toEqual(['a', 'x', 'n', 'b'])
  })

  it('clamps an out-of-range index rather than throwing', () => {
    expect(insertPagesAt(['a'], [], ['x'], 99)).toEqual(['a', 'x'])
    expect(insertPagesAt(['a'], [], ['x'], -5)).toEqual(['x', 'a'])
  })
})

describe('reorderPages', () => {
  it('collapses a sparse selection to a contiguous run at the drop point', () => {
    // Pages 0, 2 and 4 dragged to the very front.
    const out = reorderPages(['a', 'b', 'c', 'd', 'e'], [], ['a', 'c', 'e'], 0)
    expect(out).toEqual(['a', 'c', 'e', 'b', 'd'])
  })

  it('keeps the moved pages in their own natural order, never promoting the dragged card', () => {
    // Dragged starting from 'c', but 'a' and 'e' were selected too — natural
    // order still reads a, c, e.
    const out = reorderPages(['a', 'b', 'c', 'd', 'e'], [], ['e', 'a', 'c'], 0)
    expect(out).toEqual(['a', 'c', 'e', 'b', 'd'])
  })

  it('moves a single page to the end', () => {
    const out = reorderPages(['a', 'b', 'c'], [], ['a'], 2)
    expect(out).toEqual(['b', 'c', 'a'])
  })

  it('leaves the order alone when the drop lands back where the run already was', () => {
    const out = reorderPages(['a', 'b', 'c'], [], ['b'], 1)
    expect(out).toEqual(['a', 'b', 'c'])
  })

  /**
   * The spec's own worked example: [A, X̶, B, C] with X̶ tombstoned, C dragged
   * to the front. The visible pages become [C, A, B] but X̶ never leaves slot
   * 1 — it is simply carried along by whichever visible page the splice
   * lands it next to.
   */
  it('holds a tombstoned page in its own slot while the pages around it reorder', () => {
    const out = reorderPages(['A', 'X', 'B', 'C'], ['X'], ['C'], 0)
    expect(out).toEqual(['C', 'X', 'A', 'B'])
  })

  it('holds several tombstones in place at once', () => {
    const out = reorderPages(['A', 'X', 'B', 'Y', 'C'], ['X', 'Y'], ['C'], 0)
    expect(out).toEqual(['C', 'X', 'A', 'Y', 'B'])
  })

  it('is a no-op batch, not a crash, when nothing is being moved', () => {
    expect(reorderPages(['a', 'b'], [], [], 0)).toEqual(['a', 'b'])
  })

  it('clamps an out-of-range target index rather than throwing', () => {
    expect(reorderPages(['a', 'b', 'c'], [], ['a'], 99)).toEqual(['b', 'c', 'a'])
  })
})

describe('applyPageOrderSnapshot', () => {
  /**
   * The sequence the whole-overwrite reading got wrong: `[a,b]` reordered to
   * `[b,a]`, `p` imported, the import undone, and then the reorder undone.
   * `p` is tombstoned by that point but its name is still in the list, so the
   * snapshot the reorder captured no longer covers everything there is.
   */
  it('puts the pages it covers back in its own order and leaves the rest alone', () => {
    expect(applyPageOrderSnapshot(['b', 'p', 'a'], ['p'], ['a', 'b'])).toEqual(['a', 'p', 'b'])
  })

  it('is an ordinary permutation when it covers every page there is', () => {
    expect(applyPageOrderSnapshot(['b', 'a'], [], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('holds a tombstone in the slot it already sat in', () => {
    expect(applyPageOrderSnapshot(['a', 'x', 'b'], ['x'], ['b', 'a'])).toEqual(['b', 'x', 'a'])
  })

  it('changes nothing when the snapshot is the order already there', () => {
    expect(applyPageOrderSnapshot(['a', 'x', 'b'], ['x'], ['a', 'b'])).toEqual(['a', 'x', 'b'])
  })

  /**
   * A name only ever leaves `pages` through a repair, never through an undo.
   * Skipping it permutes what is actually there rather than writing the name
   * back in, which would resurrect a page the list no longer has.
   */
  it('skips a page the snapshot names that the list no longer holds', () => {
    expect(applyPageOrderSnapshot(['b', 'a'], [], ['a', 'gone', 'b'])).toEqual(['a', 'b'])
  })

  /**
   * A visible page the snapshot never saw is a conflict, not something to
   * quietly carry along: the snapshot is evidence about a chapter that has
   * since gained a page somebody can see, and there is no answer here that is
   * better than saying so.
   */
  it('refuses when a page it does not cover is one the reader can see', () => {
    expect(applyPageOrderSnapshot(['b', 'a', 'q'], [], ['a', 'b'])).toBeNull()
  })

  it('refuses on a visible page even when a tombstone is also uncovered', () => {
    expect(applyPageOrderSnapshot(['b', 'p', 'a', 'q'], ['p'], ['a', 'b'])).toBeNull()
  })

  it('has nothing to do for an empty chapter', () => {
    expect(applyPageOrderSnapshot([], [], [])).toEqual([])
  })
})
