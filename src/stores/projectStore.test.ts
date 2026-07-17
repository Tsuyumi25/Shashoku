import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectFile } from '@/types/project'
import { nextProjectFilename, reconcile, useProjectStore } from './projectStore'

describe('nextProjectFilename', () => {
  it('無撞名:資料夾名.ssk.json', () => {
    expect(nextProjectFilename('鬼滅第3話', [])).toBe('鬼滅第3話.ssk.json')
  })

  it('撞名遞增 _2、_3(大小寫不敏感)', () => {
    expect(nextProjectFilename('ch3', ['CH3.ssk.json'])).toBe('ch3_2.ssk.json')
    expect(nextProjectFilename('ch3', ['ch3.ssk.json', 'ch3_2.ssk.json'])).toBe('ch3_3.ssk.json')
  })
})

describe('reconcile', () => {
  const file = (filename: string): ProjectFile => ({ filename, labels: [] })

  it('工程檔有、磁碟無 → 標 missing', () => {
    const out = reconcile([file('001.png'), file('002.png')], ['001.png'])
    expect(out.find((f) => f.filename === '002.png')?.missing).toBe(true)
    expect(out.find((f) => f.filename === '001.png')?.missing).toBe(false)
  })

  it('磁碟有、工程檔無 → 數字感知排序後附加', () => {
    const out = reconcile([file('001.png')], ['001.png', '010.png', '002.png'])
    expect(out.map((f) => f.filename)).toEqual(['001.png', '002.png', '010.png'])
  })

  it('原有頁序不被重排,新增只附加在尾端', () => {
    const out = reconcile([file('b.png'), file('a.png')], ['b.png', 'a.png', 'c.png'])
    expect(out.map((f) => f.filename)).toEqual(['b.png', 'a.png', 'c.png'])
  })
})

describe('projectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('newProject:初始化狀態並標 dirty', () => {
    const project = useProjectStore()
    project.newProject(['001.png', '002.png'])
    expect(project.files.map((f) => f.filename)).toEqual(['001.png', '002.png'])
    expect(project.header.groups).toEqual(['框内', '框外'])
    expect(project.exportConfig.outputFormat).toBe('psd')
    expect(project.dirty).toBe(true)
    expect(project.projectFilePath).toBeNull()
  })

  it('serialize → 合法 .ssk.json,多行譯文轉行陣列', () => {
    const project = useProjectStore()
    project.newProject(['001.png'])
    project.addLabel('001.png', { id: 'a', x: 0.5, y: 0.5, category: 1, text: '一行\n二行' })

    const out = JSON.parse(project.serialize())
    expect(out.version).toBe(1)
    expect(out.images[0].labels[0].lines).toEqual(['一行', '二行'])
    expect(out.exportConfig.docTemplate).toBe('auto')
  })

  it('CRUD 皆標 dirty', () => {
    const project = useProjectStore()
    project.newProject(['001.png'])
    project.dirty = false

    project.addLabel('001.png', { id: 'a', x: 0.1, y: 0.1, category: 1, text: '' })
    expect(project.dirty).toBe(true)

    project.dirty = false
    project.updateLabelText('001.png', 'a', '改')
    expect(project.dirty).toBe(true)

    project.dirty = false
    project.moveLabel('001.png', 'a', 0.2, 0.2)
    expect(project.dirty).toBe(true)

    project.dirty = false
    project.deleteLabel('001.png', 'a')
    expect(project.dirty).toBe(true)

    project.dirty = false
    project.addGroup('第三組')
    project.renameGroup(2, '改名')
    expect(project.header.groups[2]).toBe('改名')
    expect(project.dirty).toBe(true)
  })

  it('addGroup 超過上限回傳 false', () => {
    const project = useProjectStore()
    project.newProject([])
    for (let i = project.header.groups.length; i < 9; i++) expect(project.addGroup(`g${i}`)).toBe(true)
    expect(project.addGroup('第十組')).toBe(false)
    expect(project.header.groups).toHaveLength(9)
  })
})
