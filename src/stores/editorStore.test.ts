import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { LabelItem } from '@/types/project'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'

function label(id: string, x = 0.1, y = 0.2, category = 1, text = ''): LabelItem {
  return { id, x, y, category, text }
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

  it('文字/分類/分組命令 undo 鏈', () => {
    const editor = useEditorStore()
    const project = useProjectStore()
    editor.cmdAddLabel('001.jpg', label('a'))

    editor.cmdUpdateLabelText('001.jpg', 'a', '', '你好')
    editor.cmdUpdateLabelCategory('001.jpg', 'a', 1, 2)
    editor.cmdAddGroup('分組3')
    editor.cmdRenameGroup(2, '分組3', '註釋')

    expect(project.header.groups).toEqual(['框内', '框外', '註釋'])
    const l = () => project.fileByName('001.jpg')!.labels[0]
    expect(l().text).toBe('你好')
    expect(l().category).toBe(2)

    editor.undo() // rename
    expect(project.header.groups[2]).toBe('分組3')
    editor.undo() // add group
    expect(project.header.groups).toHaveLength(2)
    editor.undo() // category
    expect(l().category).toBe(1)
    editor.undo() // text
    expect(l().text).toBe('')
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

    editor.cmdAddLabel('001.jpg', label('a', 0.123456, 0.5, 1, '第一句'))
    editor.cmdAddLabel('002.jpg', label('b', 0.9, 0.05, 2, '第二句\n第二行'))

    const out = JSON.parse(project.serialize())
    expect(out.version).toBe(1)
    expect(out.images.map((i: { filename: string }) => i.filename)).toEqual(['001.jpg', '002.jpg'])
    // 譯文的手動斷行序列化為行陣列
    expect(out.images[0].labels[0].lines).toEqual(['第一句'])
    expect(out.images[1].labels[0].lines).toEqual(['第二句', '第二行'])
    // JSON 保留完整座標精度(txt 時代截三位的限制不再存在)
    expect(out.images[0].labels[0].x).toBe(0.123456)
    expect(project.dirty).toBe(true)
  })
})
