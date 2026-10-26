import { describe, expect, it } from 'vitest'
import { cutText } from './cutText'

function joined(cut: NonNullable<ReturnType<typeof cutText>>): string {
  return cut.pieces.reduce((text, piece, i) => (i === 0 ? piece : text + cut.seams[i - 1] + piece), '')
}

describe('cutting a block where its selection runs', () => {
  it('cuts a middle stretch into three pieces that read back as the sentence', () => {
    const cut = cutText('這句話都是分散的', 3, 5)!
    expect(cut.pieces).toEqual(['這句話', '都是', '分散的'])
    expect(cut.offsets).toEqual([0, 3, 5])
    expect(joined(cut)).toBe('這句話都是分散的')
  })

  it('takes the anchor and focus in either order', () => {
    expect(cutText('abcdef', 4, 2)!.pieces).toEqual(['ab', 'cd', 'ef'])
  })

  it('cuts in two when the selection reaches an end', () => {
    const cut = cutText('好痛！', 2, 3)!
    expect(cut.pieces).toEqual(['好痛', '！'])
    expect(cut.offsets).toEqual([0, 2])
  })

  it('has nothing to cut when nothing or everything is selected', () => {
    expect(cutText('abc', 1, 1)).toBeNull()
    expect(cutText('abc', 0, 3)).toBeNull()
  })

  /** A whole line selected, break included, is still the whole text left over. */
  it('has nothing to cut when the selection leaves only line breaks behind', () => {
    expect(cutText('abc\n', 0, 3)).toBeNull()
  })

  it('moves a line break at a cut into the seam, so no piece holds a blank line', () => {
    const cut = cutText('第一行\n第二行\n第三行', 4, 7)!
    expect(cut.pieces).toEqual(['第一行', '第二行', '第三行'])
    expect(cut.seams).toEqual(['\n', '\n'])
    expect(cut.offsets).toEqual([0, 4, 8])
    expect(joined(cut)).toBe('第一行\n第二行\n第三行')
  })

  it('keeps a selection that runs over a break as two lines in one piece', () => {
    const cut = cutText('ab\ncd', 1, 4)!
    expect(cut.pieces).toEqual(['a', 'b\nc', 'd'])
    expect(joined(cut)).toBe('ab\ncd')
  })
})
