import { describe, expect, it } from 'vitest'
import type { TextLayerEntry } from '@shared/page/types'
import { selectionWords, type WordsPiece } from './selectionWords'

const piece = (id: string, sentence: string | null, at: number, ...lines: string[]): WordsPiece => ({
  entry: { id } as TextLayerEntry,
  sentence,
  at,
  lines,
})

describe('selectionWords', () => {
  it("joins one translation's pieces in their own order, whatever order they were selected in", () => {
    const words = selectionWords([piece('c', 'u1', 2, '～'), piece('a', 'u1', 0, '嘻'), piece('b', 'u1', 1, '嘿嘿')])
    expect(words).toBe('嘻嘿嘿～')
  })

  it('starts each translation on a line of its own and keeps breaks inside a piece', () => {
    const words = selectionWords([piece('a', 'u1', 0, '嘻嘿'), piece('b', 'u2', 0, '今天是怎麼了', '怎麼這麼愛撒嬌')])
    expect(words).toBe('嘻嘿\n今天是怎麼了\n怎麼這麼愛撒嬌')
  })

  it('treats objects the page says nothing about as sentences of their own', () => {
    expect(selectionWords([piece('a', null, 0, '一'), piece('b', null, 0, '二')])).toBe('一\n二')
  })
})
