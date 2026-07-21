// 圖層樹規範化——把「labels(pinia SSOT)+ projectGroups + 現有 tree」
// 收斂成「符合當前 label/group 現況」的新 tree。純函式,無 side effect,冪等。
//
// **只做搭橋:建 / 砍。永遠不動位置、順序、folder 隸屬。**
//
// PS/CSP 沒有這東西——它們沒有「label」與「text layer」拆兩層的資料模型。
// shashoku 有這個拆分(翻譯 mode 操作 label,嵌字 mode 操作 tree),所以要
// 一個小函式在兩邊維持存在性。位置由 tree 自己當 SSOT,拖曳完就是最終答案。
//
// 規則(全部 addititve,絕不改動既有位置):
// 1. 新 label(沒對應 text node)→ 建 text node
//    - label.groupId 對應的 style folder 在 tree 找得到 → append 到該 folder 尾端
//    - 否則(groupId=null 或 folder 不在)→ append 到 root 尾端
// 2. 死 label(text node 存在但 label 沒了)→ 從 tree 移除該 text node
// 3. 新 style group(沒對應 folder)→ 在 root 尾端建 folder
//    - 建立時同步 populate 該 group 對應且還沒 text node 的 labels
// 4. 死 style group(folder 存在但 group 沒了)→ 解散 folder
//    - 內部還活著的 text node 在 folder 原位置 inline 展開(不搬走)
//    - label.groupId 由呼叫端處理(通常清成 null)
// 5. 一般 group(無 styleBinding)內容過濾 orphan text,結構完整保留
// 6. **不做任何 reorder**——tree 順序完全由用戶(拖曳)決定
// 7. **不因 label.groupId 改變而搬 text**——嵌字位置一旦決定就是用戶的
//    (drag → updateLabelGroupId 的耦合是拖曳端做的,不在這裡)

import type { GroupLayerNode, Layer, TextLayerNode } from '@/engine/layer-tree'

export interface LabelRef {
  id: string
  groupId: string | null
}

export interface StyleGroupRef {
  id: string
  name: string
}

function makeTextNode(labelId: string, idGen: () => string): TextLayerNode {
  return {
    kind: 'text',
    id: idGen(),
    name: '文字',
    visible: true,
    locked: false,
    labelId,
  }
}

/** 收 tree 中所有 text node 的 labelId + style folder 的 groupId,做「已存在」查詢。 */
function collectExisting(tree: readonly Layer[]): {
  textLabelIds: Set<string>
  folderGroupIds: Set<string>
} {
  const textLabelIds = new Set<string>()
  const folderGroupIds = new Set<string>()
  const walk = (nodes: readonly Layer[]): void => {
    for (const n of nodes) {
      if (n.kind === 'text') textLabelIds.add(n.labelId)
      else if (n.kind === 'group') {
        if (n.styleBinding) folderGroupIds.add(n.styleBinding.labelGroupId)
        walk(n.children)
      }
    }
  }
  walk(tree)
  return { textLabelIds, folderGroupIds }
}

/** 一般 group:過濾 orphan text,遞迴 nested regular group,順序保留。 */
function filterRegularGroup(node: GroupLayerNode, labelIds: ReadonlySet<string>): GroupLayerNode {
  const filtered: Layer[] = []
  for (const c of node.children) {
    if (c.kind === 'text') {
      if (labelIds.has(c.labelId)) filtered.push(c)
    } else if (c.kind === 'group' && c.styleBinding === undefined) {
      filtered.push(filterRegularGroup(c, labelIds))
    } else if (c.kind === 'group' && c.styleBinding !== undefined) {
      // 一般 group 內不該有樣式 folder;歷史殘留 → dissolve
      const rebuilt = filterRegularGroup({ ...c, styleBinding: undefined } as GroupLayerNode, labelIds)
      filtered.push(...rebuilt.children)
    } else {
      filtered.push(c) // raster
    }
  }
  return { ...node, children: filtered }
}

/** 樣式 folder:過濾 orphan text(labelId 不在 labels),順序完整保留。
 *  不因 label.groupId 現在指到別的 group 而丟出——只要 labelId 還活著就留。 */
function filterStyleFolder(node: GroupLayerNode, labelIds: ReadonlySet<string>): GroupLayerNode {
  const filtered: Layer[] = []
  for (const c of node.children) {
    if (c.kind === 'text') {
      if (labelIds.has(c.labelId)) filtered.push(c)
    }
    // style folder 內只該有 text;非 text 忽略(理論上不會出現)
  }
  return { ...node, children: filtered }
}

export function normalize(
  oldTree: readonly Layer[],
  labels: readonly LabelRef[],
  projectGroups: readonly StyleGroupRef[],
  idGen: () => string,
): Layer[] {
  const labelIds = new Set(labels.map((l) => l.id))
  const groupIds = new Set(projectGroups.map((g) => g.id))
  const { textLabelIds: existingTextLabelIds, folderGroupIds: existingFolderGroupIds } =
    collectExisting(oldTree)

  // Step 1:走 oldTree 保留順序,依現況 keep / dissolve / drop
  const newRoot: Layer[] = []
  for (const node of oldTree) {
    if (node.kind === 'raster') {
      newRoot.push(node)
    } else if (node.kind === 'text') {
      if (labelIds.has(node.labelId)) newRoot.push(node)
      // orphan text → drop
    } else if (node.kind === 'group' && node.styleBinding) {
      const gid = node.styleBinding.labelGroupId
      if (groupIds.has(gid)) {
        newRoot.push(filterStyleFolder(node, labelIds))
      } else {
        // Orphan style folder → dissolve,inline still-valid text 在原位置
        for (const c of node.children) {
          if (c.kind === 'text' && labelIds.has(c.labelId)) newRoot.push(c)
        }
      }
    } else if (node.kind === 'group' && !node.styleBinding) {
      newRoot.push(filterRegularGroup(node, labelIds))
    }
  }

  // Step 2:append 新 style folders(projectGroups 有但 tree 沒對應的)
  //         建立時同步塞入該 group 對應、還沒 text node 的 labels
  for (const g of projectGroups) {
    if (existingFolderGroupIds.has(g.id)) continue
    const newTexts: TextLayerNode[] = []
    for (const l of labels) {
      if (l.groupId === g.id && !existingTextLabelIds.has(l.id)) {
        newTexts.push(makeTextNode(l.id, idGen))
        existingTextLabelIds.add(l.id) // 標記已建,step 3 不再重複
      }
    }
    newRoot.push({
      kind: 'group',
      id: idGen(),
      name: g.name,
      visible: true,
      locked: false,
      styleBinding: { labelGroupId: g.id },
      children: newTexts,
    })
  }

  // Step 3:append 新 label 的 text node(labels 有但 tree 沒對應的)
  //         決定落點:label.groupId 對應的 folder 在 newRoot 找得到 → 該 folder 尾端
  //         否則 → root 尾端
  for (const l of labels) {
    if (existingTextLabelIds.has(l.id)) continue
    const targetFolder =
      l.groupId !== null
        ? newRoot.find(
            (n): n is GroupLayerNode =>
              n.kind === 'group' && n.styleBinding?.labelGroupId === l.groupId,
          )
        : undefined
    if (targetFolder) {
      targetFolder.children.push(makeTextNode(l.id, idGen))
    } else {
      newRoot.push(makeTextNode(l.id, idGen))
    }
  }

  return newRoot
}
