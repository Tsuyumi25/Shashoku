import { describe, expect, it } from 'vitest'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { isMergeable } from '@shared/page/tree'
import {
  mergeDownPair,
  mergeParticipants,
  type MergeableEntry,
  type Takeable,
} from '@/lib/mergeTargets'

function raster(id: string): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    alphaLocked: false,
  }
}

function text(id: string): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    groupId: null,
    rotation: 0,
    lines: [id],
  }
}

function group(id: string, children: LayerEntry[]): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: PASS_THROUGH,
    children,
  }
}

/** The tree's rule alone; the editor's lock is a separate question. */
const takeable = ((entry: LayerEntry): entry is MergeableEntry => isMergeable(entry)) as Takeable

const lockedOut = (...ids: string[]): Takeable =>
  ((entry: LayerEntry): entry is MergeableEntry =>
    isMergeable(entry) && !ids.includes(entry.id)) as Takeable

const idsOf = (entries: readonly { id: string }[]) => entries.map((e) => e.id)

describe('mergeParticipants', () => {
  it('takes the rasters and steps over a translation', () => {
    const layers = [raster('a'), text('t'), raster('b')]
    const parts = mergeParticipants(layers, new Set(['a', 't', 'b']), takeable)
    expect(idsOf(parts)).toEqual(['a', 'b'])
  })

  it('takes a folder that holds nothing but pixels', () => {
    const layers = [raster('a'), group('g', [raster('r'), raster('s')])]
    expect(idsOf(mergeParticipants(layers, new Set(['a', 'g']), takeable))).toEqual(['a', 'g'])
  })

  it('steps over a folder that holds a translation', () => {
    const layers = [raster('a'), group('g', [raster('r'), text('t')])]
    expect(idsOf(mergeParticipants(layers, new Set(['a', 'g']), takeable))).toEqual(['a'])
  })

  it('steps over a locked member, as every other batch does', () => {
    const layers = [raster('a'), raster('b'), raster('c')]
    const parts = mergeParticipants(layers, new Set(['a', 'b', 'c']), lockedOut('b'))
    expect(idsOf(parts)).toEqual(['a', 'c'])
  })

  // Naming both a folder and something inside it names the same pixels twice.
  it('drops a member the selection already reaches through a folder', () => {
    const layers = [group('g', [raster('r')]), raster('s')]
    const parts = mergeParticipants(layers, new Set(['g', 'r', 's']), takeable)
    expect(idsOf(parts)).toEqual(['g', 's'])
  })

  it('answers bottom first, which is the order they are drawn in', () => {
    const layers = [raster('a'), raster('b'), raster('c')]
    expect(idsOf(mergeParticipants(layers, new Set(['c', 'a']), takeable))).toEqual(['a', 'c'])
  })
})

describe('mergeDownPair', () => {
  it('names the node and the one directly below it', () => {
    const layers = [raster('a'), raster('b'), raster('c')]
    expect(idsOf(mergeDownPair(layers, 'b', takeable))).toEqual(['a', 'b'])
  })

  it('has nothing below the bottom of a level', () => {
    expect(mergeDownPair([raster('a'), raster('b')], 'a', takeable)).toEqual([])
  })

  /**
   * Refuses rather than skips: reaching past an unmergeable neighbour would
   * drop the result below something that used to be above it, and all the
   * person did was press merge.
   */
  it('refuses when the node below is a translation', () => {
    const layers = [raster('a'), text('t'), raster('c')]
    expect(mergeDownPair(layers, 'c', takeable)).toEqual([])
  })

  it('refuses when the node below is locked', () => {
    const layers = [raster('a'), raster('b')]
    expect(mergeDownPair(layers, 'b', lockedOut('a'))).toEqual([])
  })

  it('refuses when the node itself cannot be taken', () => {
    const layers = [raster('a'), text('t')]
    expect(mergeDownPair(layers, 't', takeable)).toEqual([])
  })

  // Below means the previous sibling, not whatever is drawn under it elsewhere.
  it('stays inside the folder the node lives in', () => {
    const layers = [raster('a'), group('g', [raster('r'), raster('s')])]
    expect(idsOf(mergeDownPair(layers, 's', takeable))).toEqual(['r', 's'])
    expect(mergeDownPair(layers, 'r', takeable)).toEqual([])
  })
})
