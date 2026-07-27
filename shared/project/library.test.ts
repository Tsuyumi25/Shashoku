import { describe, expect, it } from 'vitest'
import { buildLibrary, folderName, parentFolder, type ScannedScanPoint } from './library'

function point(path: string, ...projects: string[]): ScannedScanPoint {
  return { path, projects: projects.map((p) => ({ path: p, cover: null })) }
}

describe('folderName', () => {
  it('takes the last segment', () => {
    expect(folderName('/home/a/manga/Series/ch01')).toBe('ch01')
  })

  it('ignores a trailing separator', () => {
    expect(folderName('/home/a/manga/Series/')).toBe('Series')
  })

  it('reads backslashes as separators too', () => {
    expect(folderName('C:\\Users\\a\\manga\\ch01')).toBe('ch01')
  })

  it('falls back to the whole path when there is no segment to take', () => {
    expect(folderName('/')).toBe('/')
  })
})

describe('parentFolder', () => {
  it('goes up one level', () => {
    expect(parentFolder('/m/Series/ch01')).toBe('/m/Series')
  })

  it('ignores a trailing separator', () => {
    expect(parentFolder('/m/Series/ch01/')).toBe('/m/Series')
  })

  it('keeps the root as the root', () => {
    expect(parentFolder('/OneShot')).toBe('/')
  })

  it('answers itself when there is nowhere to go up', () => {
    expect(parentFolder('OneShot')).toBe('OneShot')
  })

  it('goes up a Windows path too', () => {
    expect(parentFolder('C:\\Users\\a\\manga\\ch01')).toBe('C:\\Users\\a\\manga')
  })
})

describe('buildLibrary', () => {
  it('makes a series out of a folder holding more than one project', () => {
    const library = buildLibrary([point('/m/Series', '/m/Series/ch01', '/m/Series/ch02')])

    expect(library).toEqual([
      {
        kind: 'series',
        path: '/m/Series',
        name: 'Series',
        projects: [
          { path: '/m/Series/ch01', name: 'ch01', cover: null },
          { path: '/m/Series/ch02', name: 'ch02', cover: null },
        ],
      },
    ])
  })

  it('lays a lone project flat rather than in a series of one', () => {
    const library = buildLibrary([point('/m', '/m/OneShot')])

    expect(library).toEqual([{ kind: 'project', path: '/m/OneShot', name: 'OneShot', cover: null }])
  })

  it('drops a scan point that no longer holds a project', () => {
    expect(buildLibrary([point('/m/Gone')])).toEqual([])
  })

  it('orders pages of a series naturally, not by string', () => {
    const library = buildLibrary([
      point('/m/S', '/m/S/ch10', '/m/S/ch2', '/m/S/ch1'),
    ])

    expect(library[0].kind === 'series' && library[0].projects.map((p) => p.name)).toEqual([
      'ch1',
      'ch2',
      'ch10',
    ])
  })

  it('orders series and loose projects together by name', () => {
    const library = buildLibrary([
      point('/m', '/m/Zed'),
      point('/m/Beta', '/m/Beta/ch1', '/m/Beta/ch2'),
      point('/m2', '/m2/Alpha'),
    ])

    expect(library.map((e) => e.name)).toEqual(['Alpha', 'Beta', 'Zed'])
  })

  it('lists a project once when two scan points both reach it', () => {
    const library = buildLibrary([
      point('/m/S', '/m/S/ch01', '/m/S/ch02'),
      point('/m/S', '/m/S/ch01', '/m/S/ch02', '/m/S/ch03'),
    ])

    expect(library).toHaveLength(1)
    expect(library[0].kind === 'series' && library[0].projects.map((p) => p.name)).toEqual([
      'ch01',
      'ch02',
      'ch03',
    ])
  })

  it('leaves a project out of the flat list when a series already holds it', () => {
    const library = buildLibrary([
      point('/m/S', '/m/S/ch01', '/m/S/ch02'),
      // A scan point that reaches straight into the series' pages.
      point('/other', '/m/S/ch01'),
    ])

    expect(library).toEqual([
      {
        kind: 'series',
        path: '/m/S',
        name: 'S',
        projects: [
          { path: '/m/S/ch01', name: 'ch01', cover: null },
          { path: '/m/S/ch02', name: 'ch02', cover: null },
        ],
      },
    ])
  })

  it('carries the cover through', () => {
    const library = buildLibrary([
      { path: '/m', projects: [{ path: '/m/OneShot', cover: '001.png' }] },
    ])

    expect(library).toEqual([
      { kind: 'project', path: '/m/OneShot', name: 'OneShot', cover: '001.png' },
    ])
  })
})
