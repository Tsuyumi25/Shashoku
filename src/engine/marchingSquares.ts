// Selection mask → closed outline paths(整數座標,落在 pixel 邊界上)。
//
// 演算法:逐 pixel 掃 mask,每個 inside pixel 對 4 個 neighbor 判斷是否為邊界。
// 邊界邊都是有向的 unit segment,方向約定「inside 在前進方向的右手邊」——
// 這樣沿著 out-going direction 走就會自動繞出 clockwise(y-down 螢幕座標系)
// 的 closed loop,inside 永遠在右。
//
// 掃描順序 top-to-bottom / left-to-right 保證 saddle vertex(對角 inside)
// 的 outgoing directions 陣列會被 FIFO 消耗成「兩個獨立 pixel loop」而非
// 「bowtie 相連」——這是 PS/CSP 慣例:對角相鄰不視為連通。
//
// 只做 stroke 不做 fill,所以不需要 winding rule 判定外框 vs 孔洞——每條
// closed loop 各自獨立 stroke 即可。

import type { Rect } from './types'

export interface Point {
  x: number
  y: number
}

// 0=RIGHT(+x), 1=DOWN(+y), 2=LEFT(-x), 3=UP(-y)
type Direction = 0 | 1 | 2 | 3
const DX = [1, 0, -1, 0] as const
const DY = [0, 1, 0, -1] as const

/**
 * 把 selection mask 掃成一組 closed polyline loops(座標在 pixel 邊界上,
 * 為整數)。回傳陣列每個元素是一條 loop,首尾隱含相連(不重複列出起點)。
 *
 * bounds 是掃描範圍(通常是 selection 的 bounding box),範圍外的 pixel 一律
 * 視為 outside 處理邊界情況。
 */
export function traceMaskOutlines(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  bounds: Rect,
): Point[][] {
  // Step 1:逐 pixel 收集 out-going boundary edges
  // key = "x,y" 的 vertex,value = 從該 vertex 出發的方向 list
  const outgoing = new Map<string, Direction[]>()
  const addEdge = (x: number, y: number, d: Direction): void => {
    const k = `${x},${y}`
    const arr = outgoing.get(k)
    if (arr) arr.push(d)
    else outgoing.set(k, [d])
  }

  const x1 = Math.min(w, bounds.x + bounds.w)
  const y1 = Math.min(h, bounds.y + bounds.h)
  const x0 = Math.max(0, bounds.x)
  const y0 = Math.max(0, bounds.y)

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (mask[py * w + px] === 0) continue
      // 上邊界:top neighbor 為 out → 沿 pixel top 從 (px,py) 向右走到 (px+1,py),
      // inside pixel 在下方(前進方向的右手邊)
      if (py === 0 || mask[(py - 1) * w + px] === 0) {
        addEdge(px, py, 0)
      }
      // 右邊界:right neighbor 為 out → 從 (px+1,py) 向下走到 (px+1,py+1)
      if (px === w - 1 || mask[py * w + px + 1] === 0) {
        addEdge(px + 1, py, 1)
      }
      // 下邊界:bottom neighbor 為 out → 從 (px+1,py+1) 向左走到 (px,py+1)
      if (py === h - 1 || mask[(py + 1) * w + px] === 0) {
        addEdge(px + 1, py + 1, 2)
      }
      // 左邊界:left neighbor 為 out → 從 (px,py+1) 向上走到 (px,py)
      if (px === 0 || mask[py * w + px - 1] === 0) {
        addEdge(px, py + 1, 3)
      }
    }
  }

  // Step 2:從任一有 outgoing 的 vertex 開始走,一路 shift 出方向直到回到起點
  const loops: Point[][] = []
  while (outgoing.size > 0) {
    const startKey = outgoing.keys().next().value as string
    const [sxStr, syStr] = startKey.split(',')
    const sx = Number(sxStr)
    const sy = Number(syStr)

    const loop: Point[] = [{ x: sx, y: sy }]
    let cx = sx
    let cy = sy
    while (true) {
      const k = `${cx},${cy}`
      const outs = outgoing.get(k)
      // 理論不會發生(closed loop 每個 vertex 都有配對的 in/out),防呆
      if (!outs || outs.length === 0) break
      const d = outs.shift()!
      if (outs.length === 0) outgoing.delete(k)
      cx += DX[d]
      cy += DY[d]
      if (cx === sx && cy === sy) break
      loop.push({ x: cx, y: cy })
    }
    if (loop.length >= 3) loops.push(simplifyCollinear(loop))
  }

  return loops
}

/** 移除 collinear vertex——直線段中間點對 stroke 無意義,只留 corner。 */
function simplifyCollinear(loop: Point[]): Point[] {
  const n = loop.length
  if (n < 3) return loop
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n]
    const cur = loop[i]
    const next = loop[(i + 1) % n]
    // walk 都是 unit step,方向向量比對即可
    if (cur.x - prev.x === next.x - cur.x && cur.y - prev.y === next.y - cur.y) continue
    out.push(cur)
  }
  return out
}
