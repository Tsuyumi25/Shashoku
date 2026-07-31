import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { repairPage } from './repair'
import { validatePage } from './validate'
import { textObjects } from './tree'

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
    anchor: 'center',
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

function manifest(layers: LayerEntry[], readingOrder: string[]): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder, layers }
}

/** Deterministic replacements, so a repaired id can be named in an assertion. */
function counter(): () => string {
  let n = 0
  return () => `new-${(n += 1)}`
}

describe('repairPage', () => {
  it('leaves a sound page exactly as it was', () => {
    const sound = manifest([text('a'), text('b')], ['b', 'a'])
    const { manifest: out, repaired } = repairPage(sound, counter())
    expect(repaired).toEqual([])
    expect(out).toEqual(sound)
  })

  it('puts an unmentioned object at the end of the order', () => {
    const { manifest: out, repaired } = repairPage(
      manifest([text('a'), text('b'), text('c')], ['c', 'a']),
      counter(),
    )
    expect(out.readingOrder).toEqual(['c', 'a', 'b'])
    expect(repaired).toEqual([{ kind: 'reading-order-missing', id: 'b' }])
  })

  it('adds unmentioned objects in tree order', () => {
    const { manifest: out } = repairPage(
      manifest([text('a'), group('g', [text('b')]), text('c')], []),
      counter(),
    )
    expect(out.readingOrder).toEqual(['a', 'b', 'c'])
  })

  it('drops an order entry that lands on nothing', () => {
    const { manifest: out, repaired } = repairPage(manifest([text('a')], ['ghost', 'a']), counter())
    expect(out.readingOrder).toEqual(['a'])
    expect(repaired).toEqual([{ kind: 'reading-order-dangling', id: 'ghost' }])
  })

  it('keeps the first of a repeated entry and drops the rest', () => {
    const { manifest: out } = repairPage(manifest([text('a'), text('b')], ['a', 'b', 'a']), counter())
    expect(out.readingOrder).toEqual(['a', 'b'])
  })

  it('renames the later of two entries sharing an id, and gives it a place to be read', () => {
    const { manifest: out, repaired } = repairPage(
      manifest([text('a'), group('a', [])], ['a']),
      counter(),
    )
    expect(textObjects(out.layers).map((t) => t.id)).toEqual(['a'])
    expect(out.layers[1].id).toBe('new-1')
    expect(out.readingOrder).toEqual(['a'])
    expect(repaired).toEqual([{ kind: 'duplicate-id', id: 'a' }])
  })

  it('gives a renamed text object its own place in the order', () => {
    const { manifest: out } = repairPage(manifest([text('a'), text('a')], ['a']), counter())
    expect(out.readingOrder).toEqual(['a', 'new-1'])
  })

  it('answers with a page nothing is left to say about', () => {
    const { manifest: out } = repairPage(
      manifest([text('a'), text('a'), group('g', [text('b')])], ['ghost', 'a', 'a']),
      counter(),
    )
    expect(validatePage(out)).toEqual([])
  })

  it('does not write over the page it was given', () => {
    const broken = manifest([text('a'), text('b')], ['a', 'a'])
    repairPage(broken, counter())
    expect(broken.readingOrder).toEqual(['a', 'a'])
  })
})
