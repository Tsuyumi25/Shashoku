import { describe, expect, it } from 'vitest'
import { traceMaskOutlines, type Point } from './marchingSquares'

function mask(w: number, rows: string[]): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * rows.length)
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) {
      m[y * w + x] = rows[y][x] === '1' ? 255 : 0
    }
  }
  return m
}

function pointSet(loop: Point[]): Set<string> {
  return new Set(loop.map((p) => `${p.x},${p.y}`))
}

describe('traceMaskOutlines', () => {
  it('空 mask 沒有 loop', () => {
    const m = mask(3, ['000', '000', '000'])
    expect(traceMaskOutlines(m, 3, 3, { x: 0, y: 0, w: 3, h: 3 })).toEqual([])
  })

  it('單一 pixel 產生 4-vertex loop', () => {
    const m = mask(3, ['000', '010', '000'])
    const loops = traceMaskOutlines(m, 3, 3, { x: 0, y: 0, w: 3, h: 3 })
    expect(loops.length).toBe(1)
    expect(pointSet(loops[0])).toEqual(new Set(['1,1', '2,1', '2,2', '1,2']))
  })

  it('2x2 實心方塊產生 4-vertex loop(外框,不含內部 vertex)', () => {
    const m = mask(4, ['0000', '0110', '0110', '0000'])
    const loops = traceMaskOutlines(m, 4, 4, { x: 0, y: 0, w: 4, h: 4 })
    expect(loops.length).toBe(1)
    expect(pointSet(loops[0])).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']))
  })

  it('兩個不相鄰 pixel 產生兩條獨立 loop', () => {
    const m = mask(4, ['0000', '0100', '0010', '0000'])
    const loops = traceMaskOutlines(m, 4, 4, { x: 0, y: 0, w: 4, h: 4 })
    expect(loops.length).toBe(2)
    // 兩條 loop 都是 4-vertex
    expect(loops[0].length).toBe(4)
    expect(loops[1].length).toBe(4)
  })

  it('對角 saddle:兩個對角 inside pixel 分成兩條 loop(PS 慣例,非 bowtie)', () => {
    // (0,0) 和 (1,1) 都 inside,共角 (1,1)——不視為連通
    const m = mask(2, ['10', '01'])
    const loops = traceMaskOutlines(m, 2, 2, { x: 0, y: 0, w: 2, h: 2 })
    expect(loops.length).toBe(2)
    // 每條 loop 是繞單一 pixel 的 4-vertex
    expect(loops[0].length).toBe(4)
    expect(loops[1].length).toBe(4)
    // 共角 vertex (1,1) 應該在兩條 loop 都出現
    const allPoints = new Set<string>()
    for (const loop of loops) for (const p of loop) allPoints.add(`${p.x},${p.y}`)
    expect(allPoints.has('1,1')).toBe(true)
  })

  it('donut(中空環):外框 loop + 內框 loop 兩條', () => {
    // 3x3 環,中間 (1,1) 是洞
    const m = mask(5, ['00000', '01110', '01010', '01110', '00000'])
    const loops = traceMaskOutlines(m, 5, 5, { x: 0, y: 0, w: 5, h: 5 })
    expect(loops.length).toBe(2)
    // simplifyCollinear 後外框和內框都是 4 corner(3x3 外方 + 單 pixel 洞)
    const sizes = loops.map((l) => l.length).sort((a, b) => a - b)
    expect(sizes).toEqual([4, 4])
  })

  it('bounds 縮限:只掃指定範圍內的 pixel', () => {
    // 兩個 pixel,一個在 bounds 內、一個在外
    const m = mask(4, ['1000', '0000', '0000', '0001'])
    // 只掃左上 2x2
    const loops = traceMaskOutlines(m, 4, 4, { x: 0, y: 0, w: 2, h: 2 })
    expect(loops.length).toBe(1)
    expect(pointSet(loops[0])).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']))
  })

  it('image 邊界 pixel(貼邊):邊界視為 out,產出正確 loop', () => {
    // 貼左上角的單 pixel
    const m = mask(3, ['100', '000', '000'])
    const loops = traceMaskOutlines(m, 3, 3, { x: 0, y: 0, w: 3, h: 3 })
    expect(loops.length).toBe(1)
    expect(pointSet(loops[0])).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']))
  })

  it('橫向 2 pixel:合併成一個 6-vertex 長方形 loop', () => {
    const m = mask(4, ['0000', '0110', '0000'])
    const loops = traceMaskOutlines(m, 4, 4, { x: 0, y: 0, w: 4, h: 3 })
    expect(loops.length).toBe(1)
    expect(pointSet(loops[0])).toEqual(new Set(['1,1', '3,1', '3,2', '1,2']))
  })
})
