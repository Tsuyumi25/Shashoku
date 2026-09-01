import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceTree,
  crumbsFor,
  distinctBooks,
  type FolderNode,
  type LibraryNode,
  type RootScan,
  type WorkspaceScan,
} from './workspace'

function scanOf(root: string, folders: string[], books: string[]): RootScan {
  return {
    root,
    folders: folders.map((path) => ({ path, cover: null })),
    books: books.map((path) => ({ path, cover: null, pageCount: 1 })),
  }
}

/**
 * Two ways in, one of them standing inside the other:
 *
 *   /w                        declared
 *   └── 2026                  declared as well
 *       └── serie
 *           ├── ch1           book
 *           └── ch2           book
 *   └── loose                 book, only /w reaches it
 */
const OVERLAPPING: WorkspaceScan = {
  roots: [
    scanOf('/w', ['/w', '/w/2026', '/w/2026/serie'], ['/w/2026/serie/ch1', '/w/2026/serie/ch2', '/w/loose']),
    scanOf('/w/2026', ['/w/2026', '/w/2026/serie'], ['/w/2026/serie/ch1', '/w/2026/serie/ch2']),
  ],
}

function childAt(node: LibraryNode, path: string): LibraryNode | undefined {
  return node.kind === 'folder' ? node.children.find((each) => each.path === path) : undefined
}

describe('an entry point answers for itself', () => {
  it('keeps one that stands inside another at the top level', () => {
    const tops = buildWorkspaceTree(OVERLAPPING)
    expect(tops.map((each) => each.path)).toEqual(['/w', '/w/2026'])
  })

  it('gives each of them its own subtree', () => {
    const [outer, inner] = buildWorkspaceTree(OVERLAPPING) as FolderNode[]
    expect(outer.books).toBe(3)
    expect(inner.books).toBe(2)
    expect(childAt(inner, '/w/2026/serie')).toBeDefined()
  })

  it('marks a declared entry point wherever it is drawn', () => {
    const [outer, inner] = buildWorkspaceTree(OVERLAPPING)
    expect((inner as FolderNode).workspace).toBe(true)
    expect((childAt(outer, '/w/2026') as FolderNode).workspace).toBe(true)
  })

  it('files a book straight under the entry point that holds it', () => {
    const [outer] = buildWorkspaceTree(OVERLAPPING)
    expect(childAt(outer, '/w/loose')?.kind).toBe('book')
  })

  it('holds the order they were declared in', () => {
    const reversed: WorkspaceScan = { roots: [...OVERLAPPING.roots].reverse() }
    expect(buildWorkspaceTree(reversed).map((each) => each.path)).toEqual(['/w/2026', '/w'])
  })

  it('counts a book reached through both of them once', () => {
    expect(distinctBooks(OVERLAPPING)).toBe(3)
  })

  it('answers with the entry point itself when it is a book', () => {
    const tops = buildWorkspaceTree({ roots: [scanOf('/w/ch1', [], ['/w/ch1'])] })
    expect(tops).toHaveLength(1)
    expect(tops[0].kind).toBe('book')
  })
})

describe('crumbsFor', () => {
  const declared = ['/w', '/w/2026']

  it('stops at the nearest declared ancestor', () => {
    expect(crumbsFor(declared, '/w/2026/serie/ch1').map((each) => each.path)).toEqual([
      '/w/2026',
      '/w/2026/serie',
      '/w/2026/serie/ch1',
    ])
  })

  it('walks up to the outer one where the inner does not reach', () => {
    expect(crumbsFor(declared, '/w/loose').map((each) => each.path)).toEqual(['/w', '/w/loose'])
  })
})
