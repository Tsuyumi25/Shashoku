import { describe, expect, it } from 'vitest'
import { ProjectParseError, defaultProjectJson, parseProjectJson, serializeProjectJson } from './schema'
import { PROJECT_SCHEMA_VERSION } from './types'

function raw(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tags: [],
    seedStyle: serializeSeed(),
    comment: '',
    ...extra,
  })
}

function serializeSeed(): unknown {
  return JSON.parse(serializeProjectJson(defaultProjectJson())).seedStyle
}

describe('the page list', () => {
  it('is empty in a project that has none', () => {
    expect(parseProjectJson(raw()).pages).toEqual([])
  })

  it('keeps the order it was written in', () => {
    expect(parseProjectJson(raw({ pages: ['c', 'a', 'b'] })).pages).toEqual(['c', 'a', 'b'])
  })

  it('round trips', () => {
    const project = { ...defaultProjectJson(), pages: ['b-260809-1430', 'a-260809-1430'] }
    expect(parseProjectJson(serializeProjectJson(project))).toEqual(project)
  })

  /**
   * Refused rather than repaired: a name that walks out of `pages/` is not a
   * project that has drifted, it is one describing something it has no business
   * describing.
   */
  it('refuses a name that is more than one directory', () => {
    expect(() => parseProjectJson(raw({ pages: ['a/b'] }))).toThrow(ProjectParseError)
    expect(() => parseProjectJson(raw({ pages: ['..\\b'] }))).toThrow(ProjectParseError)
    expect(() => parseProjectJson(raw({ pages: ['..'] }))).toThrow(ProjectParseError)
  })

  it('refuses an empty name', () => {
    expect(() => parseProjectJson(raw({ pages: [''] }))).toThrow(ProjectParseError)
  })

  it('refuses a list that is not one', () => {
    expect(() => parseProjectJson(raw({ pages: 'a' }))).toThrow(ProjectParseError)
  })
})

describe('the pages marked deleted', () => {
  it('are none in a project that has never deleted one', () => {
    expect(parseProjectJson(raw({ pages: ['a', 'b'] })).deletedPages).toBeUndefined()
  })

  it('round trips', () => {
    const project = { ...defaultProjectJson(), pages: ['a', 'b', 'c'], deletedPages: ['b'] }
    expect(parseProjectJson(serializeProjectJson(project))).toEqual(project)
  })

  /**
   * Nothing holds the marks and the page list in step, so a directory tidied
   * away by hand would otherwise leave a mark nobody can reach or clear.
   */
  it('drops a mark on a page the project does not have', () => {
    const parsed = parseProjectJson(raw({ pages: ['a'], deletedPages: ['a', 'gone'] }))
    expect(parsed.deletedPages).toEqual(['a'])
  })

  it('refuses a list that is not one', () => {
    expect(() => parseProjectJson(raw({ pages: ['a'], deletedPages: 'a' }))).toThrow(
      ProjectParseError,
    )
  })
})

/**
 * Pages stopped being derived from a folder of images and became objects with
 * their own directories, and nothing carries the old shape across. Refusing is
 * the whole of the answer while there are no outside users; the day there are,
 * this stops being allowed.
 */
describe('a project from before pages had directories', () => {
  it('is refused rather than guessed at', () => {
    const older = raw({ schemaVersion: PROJECT_SCHEMA_VERSION - 1 })
    expect(() => parseProjectJson(older)).toThrow(ProjectParseError)
  })

  it('says a newer one needs newer software', () => {
    const newer = raw({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 })
    expect(() => parseProjectJson(newer)).toThrow(/請更新軟體/)
  })
})
