import { describe, expect, it } from 'vitest'
import type { GroupLayerNode, Layer, TextLayerNode } from '@/engine/layer-tree'
import type { RasterLayer } from '@/engine/types'
import { normalize, type LabelRef, type StyleGroupRef } from './normalize'

// idGen 產生穩定 id 讓 assertion 好寫;真實環境是 crypto.randomUUID。
function makeIdGen(prefix: string): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

function raster(id: string, name = id): RasterLayer {
  return {
    kind: 'raster',
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    alphaLocked: false,
    data: new Uint8ClampedArray(0),
  }
}

function text(id: string, labelId: string): TextLayerNode {
  return { kind: 'text', id, name: '文字', visible: true, locked: false, labelId }
}

function styleFolder(id: string, labelGroupId: string, children: Layer[] = []): GroupLayerNode {
  return {
    kind: 'group',
    id,
    name: `樣式:${labelGroupId}`,
    visible: true,
    locked: false,
    children,
    styleBinding: { labelGroupId },
  }
}

function regularGroup(id: string, name: string, children: Layer[] = []): GroupLayerNode {
  return { kind: 'group', id, name, visible: true, locked: false, children }
}

const groups = (arr: [string, string?][]): StyleGroupRef[] =>
  arr.map(([id, name]) => ({ id, name: name ?? id }))

const label = (id: string, groupId: string | null = null): LabelRef => ({ id, groupId })

// ─────────────────────────────────────────────────────────────────
// 1. 建 text node(新 label 進來 → 補對應節點)
// ─────────────────────────────────────────────────────────────────
describe('normalize — 建 text node(新 label)', () => {
  it('新 label groupId=null → text 節點 append 到 root 尾端', () => {
    const out = normalize([raster('bg')], [label('l1', null)], groups([]), makeIdGen('t'))
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({ kind: 'raster', id: 'bg' })
    expect((out[1] as TextLayerNode).labelId).toBe('l1')
  })

  it('新 label groupId=X 且 folder-X 已存在 → text 進 folder-X 尾端', () => {
    const folder = styleFolder('folder-a', 'g-a', [text('t-old', 'l-existing')])
    const out = normalize(
      [folder],
      [label('l-existing', 'g-a'), label('l-new', 'g-a')],
      groups([['g-a']]),
      makeIdGen('t'),
    )
    const rebuilt = out[0] as GroupLayerNode
    expect(rebuilt.children.map((c) => (c as TextLayerNode).labelId)).toEqual([
      'l-existing',
      'l-new',
    ])
  })

  it('新 label groupId=X 但 folder-X 也是新的 → text 在該新 folder 內(建立時 populate)', () => {
    const out = normalize(
      [raster('bg')],
      [label('l1', 'g-a')],
      groups([['g-a']]),
      makeIdGen('t'),
    )
    // Step 2 建新 folder 時同步 populate 對應 label
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({ kind: 'raster', id: 'bg' })
    const folder = out[1] as GroupLayerNode
    expect(folder.styleBinding?.labelGroupId).toBe('g-a')
    expect(folder.children.length).toBe(1)
    expect((folder.children[0] as TextLayerNode).labelId).toBe('l1')
  })

  it('新 label groupId 指向不存在的 group → text 落到 root 尾端(orphan groupId 當 null 處理)', () => {
    const out = normalize(
      [raster('bg')],
      [label('l1', 'g-dead')],
      groups([]),
      makeIdGen('t'),
    )
    expect(out.length).toBe(2)
    expect((out[1] as TextLayerNode).labelId).toBe('l1')
  })
})

// ─────────────────────────────────────────────────────────────────
// 2. 建 style folder(新 project group 進來 → 補對應 folder)
// ─────────────────────────────────────────────────────────────────
describe('normalize — 建 style folder(新 project group)', () => {
  it('新 group 沒對應 folder → append 到 root 尾端', () => {
    const out = normalize([raster('bg')], [], groups([['g-a']]), makeIdGen('t'))
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({ kind: 'raster', id: 'bg' })
    expect((out[1] as GroupLayerNode).styleBinding?.labelGroupId).toBe('g-a')
  })

  it('新 folder 建立時 populate 對應且沒 text node 的 labels', () => {
    const out = normalize(
      [raster('bg')],
      [label('l1', 'g-a'), label('l2', 'g-a')],
      groups([['g-a']]),
      makeIdGen('t'),
    )
    const folder = out[1] as GroupLayerNode
    expect(folder.children.map((c) => (c as TextLayerNode).labelId)).toEqual(['l1', 'l2'])
  })

  it('既有 folder 保留 id / name / visible 等 metadata', () => {
    const oldFolder = styleFolder('folder-x', 'g-a', [])
    oldFolder.name = '対白(自訂名)'
    oldFolder.visible = false
    const out = normalize([oldFolder], [], groups([['g-a', '対白']]), makeIdGen('new'))
    const folder = out[0] as GroupLayerNode
    expect(folder.id).toBe('folder-x')
    expect(folder.name).toBe('対白(自訂名)') // 用戶自訂名不被覆寫
    expect(folder.visible).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// 3. Orphan 清理(死 label / 死 group)
// ─────────────────────────────────────────────────────────────────
describe('normalize — orphan 清理', () => {
  it('orphan text node(labelId 不存在)→ 從 tree 完全移除', () => {
    const out = normalize(
      [raster('bg'), text('t-dead', 'l-gone')],
      [],
      groups([]),
      makeIdGen('new'),
    )
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({ kind: 'raster', id: 'bg' })
  })

  it('style folder 內的 orphan text 也被移除,folder 本身保留', () => {
    const folder = styleFolder('f', 'g-a', [text('t-dead', 'l-gone'), text('t-live', 'l1')])
    const out = normalize([folder], [label('l1', 'g-a')], groups([['g-a']]), makeIdGen('new'))
    const rebuilt = out[0] as GroupLayerNode
    expect(rebuilt.children.length).toBe(1)
    expect((rebuilt.children[0] as TextLayerNode).labelId).toBe('l1')
  })

  it('orphan style folder(groupId 已不在)→ 原位置 dissolve,內部 valid text inline 展開', () => {
    const oldText = text('t-live', 'l1')
    const orphanFolder = styleFolder('folder-orphan', 'g-gone', [oldText])
    const out = normalize(
      [orphanFolder, raster('bg')], // orphan folder 在 index 0
      [label('l1', null)],
      groups([]),
      makeIdGen('new'),
    )
    // folder 在原位置解散 → text 佔 folder 原位置(index 0),bg 保持 index 1
    expect(out.length).toBe(2)
    expect((out[0] as TextLayerNode).id).toBe('t-live')
    expect(out[1]).toMatchObject({ kind: 'raster', id: 'bg' })
  })

  it('空的 style folder 不刪,並保留原 tree 位置', () => {
    const emptyFolder = styleFolder('folder-empty', 'g-a', [])
    const out = normalize([emptyFolder, raster('bg')], [], groups([['g-a']]), makeIdGen('new'))
    expect(out.length).toBe(2)
    expect((out[0] as GroupLayerNode).styleBinding?.labelGroupId).toBe('g-a')
    expect((out[0] as GroupLayerNode).children).toEqual([])
    expect(out[1]).toMatchObject({ kind: 'raster', id: 'bg' })
  })
})

// ─────────────────────────────────────────────────────────────────
// 4. 一般 group(自由域)——結構完整保留
// ─────────────────────────────────────────────────────────────────
describe('normalize — 一般 group 內容保留', () => {
  it('一般 group 內部 raster / nested group / text 都完整保留', () => {
    const nested = regularGroup('nested', '子組', [raster('inner-r')])
    const parent = regularGroup('parent', '父組', [nested, text('t-in-user', 'l1')])
    const out = normalize([parent, raster('bg')], [label('l1', null)], groups([]), makeIdGen('n'))
    expect(out.length).toBe(2)
    const p = out[0] as GroupLayerNode
    expect(p.id).toBe('parent')
    expect(p.children.length).toBe(2)
    expect((p.children[0] as GroupLayerNode).id).toBe('nested')
    expect((p.children[1] as TextLayerNode).labelId).toBe('l1')
  })

  it('一般 group 內的 orphan text 被清掉,但 group 本身保留', () => {
    const grp = regularGroup('g', 'x', [text('t-dead', 'l-gone'), raster('inner')])
    const out = normalize([grp], [], groups([]), makeIdGen('n'))
    expect(out.length).toBe(1)
    const rebuilt = out[0] as GroupLayerNode
    expect(rebuilt.children.length).toBe(1)
    expect(rebuilt.children[0]).toMatchObject({ kind: 'raster', id: 'inner' })
  })

  it('已在一般 group 內的 text(label.groupId=null)→ 不動,不被搬到 root', () => {
    const oldText = text('t-in-user', 'l1')
    const userGroup = regularGroup('user-grp', '我的組', [oldText])
    const out = normalize([raster('bg'), userGroup], [label('l1', null)], groups([]), makeIdGen('n'))
    // 沒有 root 頂多出來的 text l1
    expect(out.length).toBe(2)
    const grp = out[1] as GroupLayerNode
    expect(grp.children.length).toBe(1)
    expect((grp.children[0] as TextLayerNode).id).toBe('t-in-user')
  })
})

// ─────────────────────────────────────────────────────────────────
// 5. 絕不動位置——tree 順序完全由用戶(拖曳)決定
// ─────────────────────────────────────────────────────────────────
describe('normalize — 位置不動(no reorder ever)', () => {
  it('raster / folder / text 混排 → 順序完整保留', () => {
    // 用戶拖成:text 底、raster 中、folder 頂——normalize 不能翻回去
    const t1 = text('t1', 'l1')
    const folder = styleFolder('f', 'g-a', [text('t2', 'l2')])
    const out = normalize(
      [t1, raster('bg'), folder],
      [label('l1', null), label('l2', 'g-a')],
      groups([['g-a']]),
      makeIdGen('n'),
    )
    expect(out.length).toBe(3)
    expect((out[0] as TextLayerNode).id).toBe('t1')
    expect(out[1]).toMatchObject({ kind: 'raster', id: 'bg' })
    expect((out[2] as GroupLayerNode).id).toBe('f')
  })

  it('label.groupId 改變 → text 不搬(嵌字位置由拖曳決定,不由 groupId)', () => {
    // 場景:用戶把 t-x 拖到 folder-A;之後在翻譯 mode 把 label 改成 group-B
    // normalize 不能因此把 text 搬去 folder-B
    const folderA = styleFolder('fa', 'g-a', [text('t-x', 'lx')])
    const folderB = styleFolder('fb', 'g-b', [])
    const out = normalize(
      [folderA, folderB],
      [label('lx', 'g-b')], // label 現在指 g-b,但 text 還在 fa
      groups([['g-a'], ['g-b']]),
      makeIdGen('n'),
    )
    const fa = out[0] as GroupLayerNode
    const fb = out[1] as GroupLayerNode
    expect(fa.children.map((c) => (c as TextLayerNode).labelId)).toEqual(['lx']) // 留在 fa
    expect(fb.children).toEqual([]) // fb 不接收
  })

  it('folder 內用戶手動排序 → normalize 完整保留', () => {
    const folder = styleFolder('f', 'g-a', [text('t-B', 'l-B'), text('t-A', 'l-A')])
    const out = normalize(
      [folder],
      [label('l-A', 'g-a'), label('l-B', 'g-a')], // labels 順序是 A, B
      groups([['g-a']]),
      makeIdGen('n'),
    )
    const rebuilt = out[0] as GroupLayerNode
    // 保留 tree 序 [B, A],不理 labels 順序
    expect(rebuilt.children.map((c) => (c as TextLayerNode).labelId)).toEqual(['l-B', 'l-A'])
  })

  it('user 已把 style folder 拖到 raster 之下 → normalize 保留該序,不強制 zone', () => {
    const folder = styleFolder('f', 'g-a', [text('t1', 'l1')])
    const out = normalize(
      [folder, raster('bg')], // folder 在 index 0(視覺底)
      [label('l1', 'g-a')],
      groups([['g-a']]),
      makeIdGen('n'),
    )
    expect(out.length).toBe(2)
    expect((out[0] as GroupLayerNode).id).toBe('f')
    expect(out[1]).toMatchObject({ kind: 'raster', id: 'bg' })
  })

  it('projectGroups 順序改變 → tree 上的 folder 順序不動', () => {
    // 用戶已在 tree 上排好 [fb, fa];之後 projectGroups 從 [g-a, g-b] 改成 [g-b, g-a]
    // normalize 不能因 projectGroups 順序改動 folder 位置
    const fb = styleFolder('fb', 'g-b', [])
    const fa = styleFolder('fa', 'g-a', [])
    const out = normalize(
      [fb, fa],
      [],
      groups([['g-b'], ['g-a']]), // projectGroups 是 [b, a]——本來就沒差,但確認 normalize 不動 tree 序
      makeIdGen('n'),
    )
    expect((out[0] as GroupLayerNode).id).toBe('fb')
    expect((out[1] as GroupLayerNode).id).toBe('fa')
  })
})

// ─────────────────────────────────────────────────────────────────
// 6. 冪等
// ─────────────────────────────────────────────────────────────────
describe('normalize — 冪等性', () => {
  it('normalize(normalize(x)) === normalize(x) 結構等價', () => {
    const labels: LabelRef[] = [label('l1', 'g-a'), label('l2', null), label('l3', 'g-b')]
    const grps = groups([['g-a'], ['g-b']])
    const initial: Layer[] = [raster('bg'), regularGroup('user', '我的', [raster('r1')])]

    const once = normalize(initial, labels, grps, makeIdGen('t'))
    const twice = normalize(once, labels, grps, makeIdGen('other'))
    expect(structuralShape(twice)).toEqual(structuralShape(once))
  })
})

function structuralShape(nodes: readonly Layer[]): unknown {
  return nodes.map((n) => {
    if (n.kind === 'raster') return { kind: 'raster', name: n.name, id: n.id }
    if (n.kind === 'text') return { kind: 'text', labelId: n.labelId }
    return {
      kind: 'group',
      styleBinding: n.styleBinding?.labelGroupId ?? null,
      children: structuralShape(n.children),
    }
  })
}
