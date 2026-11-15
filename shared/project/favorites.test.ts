import { describe, expect, it } from 'vitest'
import { favoriteCards, healedMembers, type Favorite } from './favorites'
import type { ProjectCard } from './workspace'

function card(path: string, id: string | null, found = true): ProjectCard {
  return { path, name: path.split('/').pop()!, found, id, cover: null, pageCount: 1 }
}

function byPath(cards: ProjectCard[]): Map<string, ProjectCard> {
  return new Map(cards.map((c) => [c.path, c]))
}

const favorite = (members: Favorite['members']): Favorite => ({ id: 'f', name: '本週', members })

describe('favoriteCards', () => {
  it('shows a member where it was put', () => {
    const here = card('/w/a', 'A')
    expect(favoriteCards(favorite([{ path: '/w/a', projectId: 'A' }]), byPath([here]), [here])).toEqual([here])
  })

  it('shows every folder carrying the member id beside it', () => {
    const original = card('/w/a', 'A')
    const copy = card('/w/b/a', 'A')
    const shown = favoriteCards(favorite([{ path: '/w/a', projectId: 'A' }]), byPath([original]), [original, copy])
    expect(shown.map((c) => c.path)).toEqual(['/w/a', '/w/b/a'])
  })

  it('follows a moved project to where its id turned up', () => {
    const moved = card('/w/done/a', 'A')
    const shown = favoriteCards(
      favorite([{ path: '/w/todo/a', projectId: 'A' }]),
      byPath([card('/w/todo/a', null, false)]),
      [moved],
    )
    expect(shown).toEqual([moved])
  })

  it('shows a member missing when its path is empty and its id is nowhere', () => {
    const [shown] = favoriteCards(favorite([{ path: '/w/a', projectId: 'A' }]), new Map(), [])
    expect(shown).toMatchObject({ path: '/w/a', found: false })
  })

  it('cannot follow a member without an id', () => {
    const [shown] = favoriteCards(favorite([{ path: '/w/a', projectId: null }]), new Map(), [card('/x/a', null)])
    expect(shown).toMatchObject({ path: '/w/a', found: false })
  })

  it('lists a folder once even when two members reach it', () => {
    const here = card('/w/a', 'A')
    const shown = favoriteCards(
      favorite([
        { path: '/w/a', projectId: 'A' },
        { path: '/old/a', projectId: 'A' },
      ]),
      byPath([here]),
      [here],
    )
    expect(shown).toEqual([here])
  })
})

describe('healedMembers', () => {
  it('points a moved member at where its id was seen', () => {
    const healed = healedMembers(favorite([{ path: '/w/todo/a', projectId: 'A' }]), new Map(), [card('/w/done/a', 'A')])
    expect(healed).toEqual([{ path: '/w/done/a', projectId: 'A' }])
  })

  it('answers null when nothing moved', () => {
    const here = card('/w/a', 'A')
    expect(healedMembers(favorite([{ path: '/w/a', projectId: 'A' }]), byPath([here]), [here])).toBeNull()
  })
})
