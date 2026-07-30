import { describe, expect, it } from 'vitest'
import { nextAutoName } from '@/lib/autoName'

describe('nextAutoName', () => {
  it('starts at one on an empty page', () => {
    expect(nextAutoName(new Set(), '圖層')).toBe('圖層1')
  })

  it('counts past what is already taken', () => {
    expect(nextAutoName(new Set(['圖層1', '圖層2']), '圖層')).toBe('圖層3')
  })

  it('walks on past a collision', () => {
    expect(nextAutoName(new Set(['圖層3', '圖層4']), '圖層')).toBe('圖層5')
  })

  /**
   * Counting from the tally rather than from one: a name that had been used and
   * deleted would otherwise be offered again to something else in the same
   * session, and the two would be indistinguishable in the undo history.
   */
  it('does not fall back onto a number that was freed by a deletion', () => {
    expect(nextAutoName(new Set(['圖層2']), '圖層')).toBe('圖層3')
  })

  it('ignores names under another prefix', () => {
    expect(nextAutoName(new Set(['資料夾1', '填充1']), '圖層')).toBe('圖層3')
  })
})
