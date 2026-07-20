import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { LabelItem } from '@/types/project'
import { useEditorStore } from './editorStore'
import { serializeTranslationForFile, useProjectStore } from './projectStore'

/**
 * 建 label 只吃座標與文字,groupId 一律 null(單元測試不涉及 group 綁定;
 * 涉及 group 的 case 需先用 project.addGroup 拿到 real id 再手動組)。
 */
function label(id: string, x = 0.1, y = 0.2, text = ''): LabelItem {
  return { id, x, y, groupId: null, text }
}

describe('editorStore undo/redo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useProjectStore().newProject(['001.jpg', '002.jpg'])
  })

  it('pushCommand 執行 do、undo/redo 來回、新 push 清空 redo 棧', () => {
    const editor = useEditorStore()
    const log: string[] = []
    const cmd = (name: string) => ({
      label: name,
      do: () => log.push(`do-${name}`),
      undo: () => log.push(`undo-${name}`),
    })

    editor.pushCommand(cmd('a'))
    editor.pushCommand(cmd('b'))
    expect(log).toEqual(['do-a', 'do-b'])
    expect(editor.canUndo).toBe(true)
    expect(editor.canRedo).toBe(false)

    editor.undo()
    expect(log).toEqual(['do-a', 'do-b', 'undo-b'])
    expect(editor.canRedo).toBe(true)

    editor.redo()
    expect(log).toEqual(['do-a', 'do-b', 'undo-b', 'do-b'])

    editor.undo()
    editor.pushCommand(cmd('c'))
    expect(editor.canRedo).toBe(false) // redo 棧被清掉
    expect(log).toEqual(['do-a', 'do-b', 'undo-b', 'do-b', 'undo-b', 'do-c'])
  })

  it('cmdAddLabel：undo 移除、redo 加回原位置', () => {
    const editor = useEditorStore()
    const project = useProjectStore()

    editor.cmdAddLabel('001.jpg', label('a'))
    editor.cmdAddLabel('001.jpg', label('b'))
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['a', 'b'])
    expect(editor.selectedLabelId).toBe('b')

    editor.undo()
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['a'])
    editor.redo()
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('cmdDuplicateLabel(lazy-do):拖曳副本只佔一筆 undo', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    editor.cmdAddLabel('001.jpg', label('source', 0.1, 0.2, '文字'))

    const copy = label('copy', 0.8, 0.9, '文字')
    // 模擬 Alt+drag:越過門檻時先插入,拖曳中已移到最終位置。
    project.addLabel('001.jpg', copy)
    editor.cmdDuplicateLabel('001.jpg', copy, { alreadyApplied: true })

    expect(project.fileByName('001.jpg')!.labels).toEqual([
      label('source', 0.1, 0.2, '文字'),
      copy,
    ])
    expect(editor.selectedLabelId).toBe('copy')

    editor.undo()
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['source'])
    editor.redo()
    expect(project.fileByName('001.jpg')!.labels).toEqual([
      label('source', 0.1, 0.2, '文字'),
      copy,
    ])
  })

  it('cmdDeleteLabel：undo 還原到原 index', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    for (const id of ['a', 'b', 'c']) editor.cmdAddLabel('001.jpg', label(id))

    editor.cmdDeleteLabel('001.jpg', 'b')
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['a', 'c'])

    editor.undo()
    expect(project.fileByName('001.jpg')!.labels.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('cmdMoveLabel（lazy-do）：push 時不重複套用、undo/redo 正確', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    editor.cmdAddLabel('001.jpg', label('a', 0.1, 0.1))

    // 模擬拖曳：即時 mutate 後才提交 command
    project.moveLabel('001.jpg', 'a', 0.8, 0.9)
    editor.cmdMoveLabel('001.jpg', 'a', { x: 0.1, y: 0.1 }, { x: 0.8, y: 0.9 })

    const get = () => {
      const l = project.fileByName('001.jpg')!.labels[0]
      return { x: l.x, y: l.y }
    }
    expect(get()).toEqual({ x: 0.8, y: 0.9 })
    editor.undo()
    expect(get()).toEqual({ x: 0.1, y: 0.1 })
    editor.redo()
    expect(get()).toEqual({ x: 0.8, y: 0.9 })
  })

  it('文字/分組綁定/分組 CRUD 命令 undo 鏈', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    editor.cmdAddLabel('001.jpg', label('a'))
    const defaultGroups = project.header.groups.map((g) => g.name)
    // 兩個預設 group 由 defaultProjectJson 產出;取 groups[0].id 給 label
    const grp0 = project.header.groups[0].id
    const grp1 = project.header.groups[1].id

    editor.cmdUpdateLabelText('001.jpg', 'a', '', '你好')
    editor.cmdUpdateLabelGroupId('001.jpg', 'a', null, grp0)
    editor.cmdUpdateLabelGroupId('001.jpg', 'a', grp0, grp1)
    editor.cmdAddGroup('分組3')
    const grp2 = project.header.groups[2].id
    editor.cmdRenameGroup(2, '分組3', '註釋')

    expect(project.header.groups.map((g) => g.name)).toEqual([...defaultGroups, '註釋'])
    const l = () => project.fileByName('001.jpg')!.labels[0]
    expect(l().text).toBe('你好')
    expect(l().groupId).toBe(grp1)

    editor.undo() // rename
    expect(project.header.groups[2].name).toBe('分組3')
    editor.undo() // add group
    expect(project.header.groups).toHaveLength(2)
    // undo add group 必須走 store method 才會標 metaDirty(否則 save() short-circuit)
    expect(project.metaDirty).toBe(true)
    editor.undo() // groupId grp0 → grp1
    expect(l().groupId).toBe(grp0)
    editor.undo() // groupId null → grp0
    expect(l().groupId).toBeNull()
    editor.undo() // text
    expect(l().text).toBe('')
    // grp2 是 add-group 產生的 id;確認 undo 後不再存在於 groups
    expect(project.header.groups.find((g) => g.id === grp2)).toBeUndefined()
  })

  it('selectLabelBy 跨頁：頁界換頁、空頁也是一站、文件邊界停下', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    project.newProject(['001.jpg', '002.jpg', '003.jpg']) // 002 留空頁
    for (const id of ['a1', 'a2']) editor.cmdAddLabel('001.jpg', label(id))
    editor.cmdAddLabel('003.jpg', label('c1'))

    editor.selectFile('001.jpg')
    expect(editor.selectedLabelId).toBe('a1')
    editor.selectLabelBy(1)
    expect(editor.selectedLabelId).toBe('a2')

    // 頁尾向下 → 落在空頁(不跳過),再向下 → 003 第一個
    editor.selectLabelBy(1)
    expect(editor.currentFilename).toBe('002.jpg')
    expect(editor.selectedLabelId).toBeNull()
    editor.selectLabelBy(1)
    expect(editor.currentFilename).toBe('003.jpg')
    expect(editor.selectedLabelId).toBe('c1')

    // 倒著走:空頁一站,再向上落在前頁「最後一個」
    editor.selectLabelBy(-1)
    expect(editor.currentFilename).toBe('002.jpg')
    editor.selectLabelBy(-1)
    expect(editor.currentFilename).toBe('001.jpg')
    expect(editor.selectedLabelId).toBe('a2')

    // 文件邊界:第一頁頁首向上、最後一頁頁尾向下都停在原地
    editor.selectLabelBy(-1)
    editor.selectLabelBy(-1)
    expect(editor.currentFilename).toBe('001.jpg')
    expect(editor.selectedLabelId).toBe('a1')
    editor.selectFile('003.jpg')
    editor.selectLabelBy(1)
    expect(editor.currentFilename).toBe('003.jpg')
    expect(editor.selectedLabelId).toBe('c1')
  })

  it('整合：store 操作後 serialize 輸出正確的 .ssk.json', () => {
    const editor = useEditorStore()
    const project = useProjectStore()

    editor.cmdAddLabel('001.jpg', label('a', 0.123456, 0.5, '第一句'))
    editor.cmdAddLabel('002.jpg', label('b', 0.9, 0.05, '第二句\n第二行'))

    // 新架構:每頁一份 translation.json,分別序列化驗
    const t1 = JSON.parse(serializeTranslationForFile(project.fileByName('001.jpg')!))
    const t2 = JSON.parse(serializeTranslationForFile(project.fileByName('002.jpg')!))
    expect(t1.schemaVersion).toBe(2)
    expect(t2.schemaVersion).toBe(2)
    // 譯文的手動斷行序列化為行陣列
    expect(t1.labels[0].lines).toEqual(['第一句'])
    expect(t2.labels[0].lines).toEqual(['第二句', '第二行'])
    // JSON 保留完整座標精度(txt 時代截三位的限制不再存在)
    expect(t1.labels[0].x).toBe(0.123456)
    // 未綁 group 序列化為 groupId: null
    expect(t1.labels[0].groupId).toBeNull()
    expect(project.dirty).toBe(true)
  })
})
