import { describe, expect, it } from 'vitest'
import { pageDirName, reconcilePages } from './pages'

const AT = new Date(2026, 7, 9, 14, 30)

function bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

describe('pageDirName', () => {
  it('carries the source stem and the moment the page was made', () => {
    expect(pageDirName('001.jpg', AT, new Set())).toBe('001-260809-1430')
  })

  it('pads a single-digit month, day, hour and minute', () => {
    expect(pageDirName('a.png', new Date(2026, 0, 2, 3, 4), new Set())).toBe('a-260102-0304')
  })

  it('drops only the extension, not every dot', () => {
    expect(pageDirName('ch01.v2.png', AT, new Set())).toBe('ch01.v2-260809-1430')
  })

  it('keeps a name that has no extension whole', () => {
    expect(pageDirName('cover', AT, new Set())).toBe('cover-260809-1430')
  })

  /**
   * Manga raws are a shared prefix and a page number, so the tail is the only
   * part that tells two pages apart. Cutting from the front would give a whole
   * chapter the same name.
   */
  it('cuts the tail off a long stem, never the head', () => {
    const stem = 'chapter-one-'.repeat(10)
    const name = pageDirName(`${stem}.jpg`, AT, new Set())
    expect(name.startsWith('chapter-one-chapter')).toBe(true)
    expect(name.endsWith('-260809-1430')).toBe(true)
  })

  it('holds the stem to sixty bytes', () => {
    const name = pageDirName(`${'x'.repeat(200)}.jpg`, AT, new Set())
    expect(bytes(name.slice(0, -'-260809-1430'.length))).toBe(60)
  })

  /** CJK is three bytes a character, so a byte budget is not a character count. */
  it('counts bytes rather than characters', () => {
    const name = pageDirName(`${'第'.repeat(40)}.jpg`, AT, new Set())
    const stem = name.slice(0, -'-260809-1430'.length)
    expect(bytes(stem)).toBeLessThanOrEqual(60)
    expect([...stem].length).toBe(20)
  })

  /**
   * A cut inside a character leaves bytes no decoder can read, and a cut
   * between a character and its variation selector leaves the selector an
   * orphan. Both are avoided by cutting between grapheme clusters.
   */
  it('cuts between whole characters', () => {
    const name = pageDirName(`${'あ'.repeat(30)}.jpg`, AT, new Set())
    expect(name.includes('�')).toBe(false)
    expect(bytes(name.slice(0, -'-260809-1430'.length))).toBe(60)
  })

  it('does not leave a variation selector without the character it belongs to', () => {
    // A heart is U+2665 plus U+FE0F, six bytes together, so ten of them fill
    // the budget exactly and the eleventh would be cut through the middle.
    const name = pageDirName(`${'♥️'.repeat(11)}.jpg`, AT, new Set())
    const stem = name.slice(0, -'-260809-1430'.length)
    expect(stem).toBe('♥️'.repeat(10))
  })

  it('refuses to let a source name reach outside the pages folder', () => {
    expect(pageDirName('../../etc/passwd.jpg', AT, new Set())).toBe('....etcpasswd-260809-1430')
  })

  /**
   * A project folder is meant to be handed to someone else, and a name Windows
   * cannot create would make the copy fail rather than arrive incomplete.
   */
  it('drops the characters Windows will not accept in a name', () => {
    expect(pageDirName('a<b>c:d"e|f?g*h.jpg', AT, new Set())).toBe('abcdefgh-260809-1430')
  })

  it('still yields a name when nothing of the stem survives', () => {
    expect(pageDirName('///.jpg', AT, new Set())).toBe('260809-1430')
  })

  it('counts up past a name already taken', () => {
    const taken = new Set(['001-260809-1430'])
    expect(pageDirName('001.jpg', AT, taken)).toBe('001-260809-1430-2')
  })

  it('keeps counting while the counted names are taken too', () => {
    const taken = new Set(['001-260809-1430', '001-260809-1430-2', '001-260809-1430-3'])
    expect(pageDirName('001.jpg', AT, taken)).toBe('001-260809-1430-4')
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

  it('has nothing to say about an empty project', () => {
    expect(reconcilePages([], [])).toEqual({ order: [], missing: [], adopted: [] })
  })
})
