import { describe, expect, it } from 'vitest'
import { clipPathOf } from './frames'
import { partitionPage, type Rect } from './partition'

describe('clipPathOf', () => {
  it('draws one rectangle per run', () => {
    const runs: Rect[] = [
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 20, y: 8, w: 5, h: 4 },
    ]
    expect(clipPathOf(runs)).toBe('path("M0 0H10V4H0ZM20 8H25V12H20Z")')
  })

  it('merges rows of the same width into one rectangle', () => {
    const runs: Rect[] = [
      { x: 4, y: 0, w: 10, h: 4 },
      { x: 4, y: 4, w: 10, h: 4 },
      { x: 4, y: 8, w: 10, h: 4 },
    ]
    expect(clipPathOf(runs)).toBe('path("M4 0H14V12H4Z")')
  })

  it('merges the overlap a cut leaves between neighbouring rows', () => {
    const partition = partitionPage({ w: 400, h: 400 }, [], 1)
    expect(partition.regions).toHaveLength(1)
    const path = clipPathOf(partition.regions[0].runs)
    expect(path.match(/M/g)).toHaveLength(1)
  })

  it('keeps a row whose width changes apart from the one above it', () => {
    const runs: Rect[] = [
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 0, y: 4, w: 20, h: 4 },
    ]
    expect(clipPathOf(runs)).toBe('path("M0 0H10V4H0ZM0 4H20V8H0Z")')
  })
})
