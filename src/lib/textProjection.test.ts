import { describe, expect, it } from 'vitest'
import type { EngineClusterRect } from '@shared/engine/types'
import { byteAt, byteOffsets, indexOfByte, textProjection } from './textProjection'

describe('byteOffsets', () => {
  it('counts one byte per ASCII character', () => {
    expect(byteOffsets('abc')).toEqual([0, 1, 2, 3])
  })

  it('counts three bytes per CJK character', () => {
    expect(byteOffsets('你好')).toEqual([0, 3, 6])
  })

  it('gives both halves of a surrogate pair the same offset', () => {
    // 🍣 is one code point, two UTF-16 units, four UTF-8 bytes.
    expect(byteOffsets('a🍣b')).toEqual([0, 1, 1, 5, 6])
  })

  it('mixes widths across one string', () => {
    expect(byteOffsets('a你b')).toEqual([0, 1, 4, 5])
  })

  it('answers for the empty string', () => {
    expect(byteOffsets('')).toEqual([0])
  })
})

describe('byteAt', () => {
  const table = byteOffsets('a你b')

  it('reads an index straight off the table', () => {
    expect(byteAt(table, 2)).toBe(4)
  })

  it('clamps an index past the end to the end', () => {
    expect(byteAt(table, 99)).toBe(5)
  })

  it('clamps a negative index to the start', () => {
    expect(byteAt(table, -3)).toBe(0)
  })
})

describe('indexOfByte', () => {
  it('inverts byteAt for every index of a mixed string', () => {
    for (const text of ['abc', '你好世界', 'a你b', '🍣🍤', 'a🍣你b']) {
      const table = byteOffsets(text)
      for (let i = 0; i <= text.length; i += 1) {
        // A trailing surrogate shares its lead's offset, so it maps back to the
        // lead — which is the only index a caret may sit at.
        const expected = table[i] === table[i - 1] ? i - 1 : i
        expect(indexOfByte(table, byteAt(table, i))).toBe(expected)
      }
    }
  })

  it('rounds a byte inside a character down to that character', () => {
    const table = byteOffsets('你好')
    expect(indexOfByte(table, 1)).toBe(0)
    expect(indexOfByte(table, 4)).toBe(1)
  })

  it('clamps a byte past the end to the last index', () => {
    const table = byteOffsets('你')
    expect(indexOfByte(table, 99)).toBe(1)
  })
})

const CHAR_MAIN = 10
const CHAR_CROSS = 20
const PADDING = 4

/** Two rows of two characters, laid out left to right and top to bottom. */
function horizontalClusters(): EngineClusterRect[] {
  return [
    { cluster: 0, x: PADDING, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
    { cluster: 1, x: PADDING + CHAR_MAIN, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
    { cluster: 3, x: PADDING, y: PADDING + CHAR_CROSS, width: CHAR_MAIN, height: CHAR_CROSS },
    {
      cluster: 4,
      x: PADDING + CHAR_MAIN,
      y: PADDING + CHAR_CROSS,
      width: CHAR_MAIN,
      height: CHAR_CROSS,
    },
  ]
}

function horizontal() {
  return textProjection({
    text: 'ab\ncd',
    clusters: horizontalClusters(),
    vertical: false,
    padding: PADDING,
    crossExtent: PADDING * 2 + CHAR_CROSS * 2,
  })
}

/** The same two lines as columns, the first against the right edge. */
const VERTICAL_WIDTH = PADDING * 2 + CHAR_CROSS * 2
const FIRST_COLUMN_X = VERTICAL_WIDTH - PADDING - CHAR_CROSS

function verticalClusters(): EngineClusterRect[] {
  return [
    { cluster: 0, x: FIRST_COLUMN_X, y: PADDING, width: CHAR_CROSS, height: CHAR_MAIN },
    {
      cluster: 1,
      x: FIRST_COLUMN_X,
      y: PADDING + CHAR_MAIN,
      width: CHAR_CROSS,
      height: CHAR_MAIN,
    },
    { cluster: 3, x: PADDING, y: PADDING, width: CHAR_CROSS, height: CHAR_MAIN },
    { cluster: 4, x: PADDING, y: PADDING + CHAR_MAIN, width: CHAR_CROSS, height: CHAR_MAIN },
  ]
}

function vertical() {
  return textProjection({
    text: 'ab\ncd',
    clusters: verticalClusters(),
    vertical: true,
    padding: PADDING,
    crossExtent: VERTICAL_WIDTH,
  })
}

/** Three lines with the middle one empty, so it has no glyph to measure. */
function blankLine() {
  return textProjection({
    text: 'a\n\nb',
    clusters: [
      { cluster: 0, x: PADDING, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
      {
        cluster: 3,
        x: PADDING,
        y: PADDING + CHAR_CROSS * 2,
        width: CHAR_MAIN,
        height: CHAR_CROSS,
      },
    ],
    vertical: false,
    padding: PADDING,
    crossExtent: PADDING * 2 + CHAR_CROSS * 3,
  })
}

describe('lines', () => {
  it('splits on newlines', () => {
    const p = horizontal()
    expect(p.lineCount).toBe(2)
    expect(p.lineOf(0)).toBe(0)
    expect(p.lineOf(2)).toBe(0)
    expect(p.lineOf(3)).toBe(1)
    expect(p.lineRange(0)).toEqual([0, 2])
    expect(p.lineRange(1)).toEqual([3, 5])
  })
})

describe('caret, horizontal', () => {
  it('sits at the leading edge of the character it precedes', () => {
    expect(horizontal().caret(0)).toEqual({
      x: PADDING,
      y: PADDING,
      width: 0,
      height: CHAR_CROSS,
    })
  })

  it('sits at the trailing edge of the last character of a line', () => {
    expect(horizontal().caret(2)).toEqual({
      x: PADDING + CHAR_MAIN * 2,
      y: PADDING,
      width: 0,
      height: CHAR_CROSS,
    })
  })

  it('starts the next line rather than ending the previous one', () => {
    expect(horizontal().caret(3)).toEqual({
      x: PADDING,
      y: PADDING + CHAR_CROSS,
      width: 0,
      height: CHAR_CROSS,
    })
  })
})

describe('caret, vertical', () => {
  it('is a horizontal bar on the leading edge of its character', () => {
    expect(vertical().caret(0)).toEqual({
      x: FIRST_COLUMN_X,
      y: PADDING,
      width: CHAR_CROSS,
      height: 0,
    })
  })

  it('walks columns right to left', () => {
    expect(vertical().caret(3)).toEqual({
      x: PADDING,
      y: PADDING,
      width: CHAR_CROSS,
      height: 0,
    })
  })
})

describe('selection', () => {
  it('is empty when the range is collapsed', () => {
    expect(horizontal().selection(2, 2)).toEqual([])
  })

  it('draws one box per line it crosses', () => {
    expect(horizontal().selection(0, 5)).toEqual([
      { x: PADDING, y: PADDING, width: CHAR_MAIN * 2, height: CHAR_CROSS },
      { x: PADDING, y: PADDING + CHAR_CROSS, width: CHAR_MAIN * 2, height: CHAR_CROSS },
    ])
  })

  it('reads the same range given backwards', () => {
    expect(horizontal().selection(5, 0)).toEqual(horizontal().selection(0, 5))
  })

  it('stops at the end of the range inside a line', () => {
    expect(horizontal().selection(0, 1)).toEqual([
      { x: PADDING, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
    ])
  })

  it('runs down the columns when vertical', () => {
    expect(vertical().selection(0, 5)).toEqual([
      { x: FIRST_COLUMN_X, y: PADDING, width: CHAR_CROSS, height: CHAR_MAIN * 2 },
      { x: PADDING, y: PADDING, width: CHAR_CROSS, height: CHAR_MAIN * 2 },
    ])
  })

  it('gives a blank line a sliver so the run stays continuous', () => {
    const boxes = blankLine().selection(0, 4)
    expect(boxes).toHaveLength(3)
    expect(boxes[1]!.width).toBeGreaterThan(0)
    expect(boxes[1]!.y).toBe(PADDING + CHAR_CROSS)
  })

  it('gives a blank line a sliver for its own break alone', () => {
    const boxes = blankLine().selection(2, 3)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.y).toBe(PADDING + CHAR_CROSS)
  })

  it('draws nothing on a line the range only touches at its edge', () => {
    // 0..2 ends exactly where line 0 ends; line 1 holds none of it.
    expect(horizontal().selection(0, 2)).toHaveLength(1)
  })

  it('draws nothing on a blank line the range only touches at its edge', () => {
    // Shift+Right from the end of line 0 takes that line's break and no more.
    // The blank line below starts where the range ends, so it holds none of it.
    expect(blankLine().selection(1, 2)).toEqual([])
  })
})

describe('indexAt', () => {
  it('takes the near half of a character as the position before it', () => {
    expect(horizontal().indexAt(PADDING + 1, PADDING + 1)).toBe(0)
  })

  it('takes the far half as the position after it', () => {
    expect(horizontal().indexAt(PADDING + CHAR_MAIN - 1, PADDING + 1)).toBe(1)
  })

  it('clamps past the end of a line to that line, not the next', () => {
    expect(horizontal().indexAt(999, PADDING + 1)).toBe(2)
  })

  it('clamps before the start of a line to its start', () => {
    expect(horizontal().indexAt(-999, PADDING + CHAR_CROSS + 1)).toBe(3)
  })

  it('reads a point in the second line', () => {
    expect(horizontal().indexAt(PADDING + 1, PADDING + CHAR_CROSS + 1)).toBe(3)
  })

  it('clamps a point past the last line into it', () => {
    expect(horizontal().indexAt(PADDING + 1, 999)).toBe(3)
  })

  it('walks columns right to left when vertical', () => {
    expect(vertical().indexAt(FIRST_COLUMN_X + 1, PADDING + 1)).toBe(0)
    expect(vertical().indexAt(PADDING + 1, PADDING + 1)).toBe(3)
  })

  it('lands on the character a click hit for non-BMP text', () => {
    const p = textProjection({
      text: '🍣🍤',
      clusters: [
        { cluster: 0, x: PADDING, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
        { cluster: 4, x: PADDING + CHAR_MAIN, y: PADDING, width: CHAR_MAIN, height: CHAR_CROSS },
      ],
      vertical: false,
      padding: PADDING,
      crossExtent: PADDING * 2 + CHAR_CROSS,
    })
    expect(p.indexAt(PADDING + 1, PADDING + 1)).toBe(0)
    // The second sushi starts at index 2, not 1: the first one is a pair.
    expect(p.indexAt(PADDING + CHAR_MAIN + 1, PADDING + 1)).toBe(2)
    expect(p.indexAt(999, PADDING + 1)).toBe(4)
  })
})

describe('a run with no glyphs at all', () => {
  const p = textProjection({
    text: '\n',
    clusters: [],
    vertical: false,
    padding: PADDING,
    crossExtent: PADDING * 2 + CHAR_CROSS * 2,
  })

  it('divides the box between its lines', () => {
    expect(p.caret(0)).toEqual({ x: PADDING, y: PADDING, width: 0, height: CHAR_CROSS })
    expect(p.caret(1)).toEqual({
      x: PADDING,
      y: PADDING + CHAR_CROSS,
      width: 0,
      height: CHAR_CROSS,
    })
  })

  it('puts a click on the line it landed in', () => {
    expect(p.indexAt(PADDING, PADDING + CHAR_CROSS + 1)).toBe(1)
  })
})
