import { describe, expect, it } from 'vitest'
import { defaultExportProfile } from '@shared/export/types'
import { defaultProjectJson } from '@shared/project/schema'
import type { ProjectJson } from '@shared/project/types'
import type { ProjectFile } from '@/types/project'
import { thumbnailKey } from '@/lib/pageThumbnail'

function page(): ProjectFile {
  return {
    filename: '001.png',
    pageDir: '/p/.shashoku/pages/001',
    badge: 'ok',
    labels: [{ id: 'a', x: 0.5, y: 0.5, groupId: null, rotation: 0, text: 'ふむ' }],
  }
}

/** What a thumbnail is a picture of, and nothing else, decides its key. */
describe('thumbnailKey', () => {
  it('is unchanged by what a delivery looks like', async () => {
    const before: ProjectJson = defaultProjectJson()
    const after: ProjectJson = {
      ...before,
      exportProfiles: [{ ...defaultExportProfile(), format: 'jpeg', maxBytes: 2_000_000 }],
    }

    expect(await thumbnailKey(page(), after)).toBe(await thumbnailKey(page(), before))
  })

  it('is unchanged by a group being renamed or recoloured', async () => {
    const before: ProjectJson = defaultProjectJson()
    const after: ProjectJson = {
      ...before,
      groups: before.groups.map((g, i) =>
        i === 0 ? { ...g, name: '框外', color: '#ff0000' } : g,
      ),
    }

    expect(await thumbnailKey(page(), after)).toBe(await thumbnailKey(page(), before))
  })

  it('changes when a group restyles the text it lays over', async () => {
    const before: ProjectJson = defaultProjectJson()
    const after: ProjectJson = {
      ...before,
      groups: before.groups.map((g, i) =>
        i === 0 ? { ...g, style: { ...g.style, fontSizePx: g.style.fontSizePx + 1 } } : g,
      ),
    }

    expect(await thumbnailKey(page(), after)).not.toBe(await thumbnailKey(page(), before))
  })

  it('changes when the default style moves', async () => {
    const before: ProjectJson = defaultProjectJson()
    const after: ProjectJson = {
      ...before,
      defaultStyle: { ...before.defaultStyle, fontSizePx: before.defaultStyle.fontSizePx + 1 },
    }

    expect(await thumbnailKey(page(), after)).not.toBe(await thumbnailKey(page(), before))
  })

  it('changes when the page is retyped', async () => {
    const meta = defaultProjectJson()
    const edited = page()
    edited.labels[0].text = 'なるほど'

    expect(await thumbnailKey(edited, meta)).not.toBe(await thumbnailKey(page(), meta))
  })

  it('separates pages that hold the same labels', async () => {
    const meta = defaultProjectJson()
    const other = { ...page(), pageDir: '/p/.shashoku/pages/002' }

    expect(await thumbnailKey(other, meta)).not.toBe(await thumbnailKey(page(), meta))
  })

  it('separates the sizes it is asked to draw', async () => {
    const meta = defaultProjectJson()

    expect(await thumbnailKey(page(), meta, 320)).not.toBe(await thumbnailKey(page(), meta, 640))
  })
})
