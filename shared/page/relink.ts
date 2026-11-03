import type { TextStyle } from '../text-style/types'
import type { ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import type { TextSide } from './text'
import { readAfter, sourceOrder } from './reading'
import { blankSourceBlock, blankTranslationBlock } from './schema'
import { findTextObject, insertAtPath, pathOf, removeAtPath, textObjects } from './tree'
import { facePage, placeOfBlock, shownCodeOf, type FacePage } from './units'

/**
 * What Ctrl+L does with the blocks selected on one page, worked out before
 * anything is written so the canvas can show it while Ctrl is held.
 *
 * Decided by which sides the selection holds, never by which side the canvas
 * shows — the same selection always means the same thing:
 *
 *   one side   these are one sentence: every sentence they belong to is folded
 *              into the first of them in reading order, both sides travelling
 *   two sides  this goes with that: the selected blocks move into the sentence
 *              of the selected source, and nothing else moves
 *
 * Only this face's ledger moves. Every face cuts the page into sentences its
 * own way, so joining two balloons here says nothing about another language.
 */
export type RelinkPlan =
  | { kind: 'join'; main: string; folded: string[]; moving: string[] }
  | { kind: 'pair'; main: string; moving: string[] }
  | { kind: 'none' }

function firstInOrder(page: FacePage, units: Iterable<string>): string | undefined {
  const wanted = new Set(units)
  return page.readingOrder.find((id) => wanted.has(id)) ?? [...wanted][0]
}

export function planRelink(page: FacePage, selected: readonly string[]): RelinkPlan {
  const places = selected
    .map((id) => ({ id, place: placeOfBlock(page, id) }))
    .filter((p): p is { id: string; place: NonNullable<ReturnType<typeof placeOfBlock>> } => !!p.place)
  if (places.length === 0) return { kind: 'none' }
  const sides = new Set(places.map((p) => p.place.side))
  const units = new Set(places.map((p) => p.place.unit.id))

  if (sides.size === 1) {
    if (units.size < 2) return { kind: 'none' }
    const main = firstInOrder(page, units)!
    const folded = [...units].filter((u) => u !== main)
    const moving = page.units.filter((u) => folded.includes(u.id)).flatMap((u) => u.members)
    return { kind: 'join', main, folded, moving }
  }

  const main = firstInOrder(page, places.filter((p) => p.place.side === 'source').map((p) => p.place.unit.id))!
  const moving = places.filter((p) => p.place.unit.id !== main).map((p) => p.id)
  return moving.length ? { kind: 'pair', main, moving } : { kind: 'none' }
}

/** Shown text decides blankness, so a block reading a chosen candidate is not blank. */
function isBlank(page: FacePage, id: string): boolean {
  const block = findTextObject(page.layers, id)
  return !block || shownCodeOf(block).trim() === ''
}

function sideOfBlock(page: FacePage, id: string): TextSide | undefined {
  return findTextObject(page.layers, id)?.side
}

function dropBlock(page: FacePage, id: string) {
  const path = pathOf(page.layers, id)
  if (path) removeAtPath(page.layers, path)
}

function moveBlock(page: FacePage, id: string, to: TranslationUnit) {
  const from = placeOfBlock(page, id)?.unit
  if (!from || from.id === to.id) return
  from.members = from.members.filter((m) => m !== id)
  to.members.push(id)
}

/**
 * A side that has real words loses its blank placeholders; a side left with
 * nothing gets one, standing where the sentence's other blocks stand; a unit
 * left with nothing but blanks is gone, with its place in the reading and its
 * lines.
 *
 * ⚠️ A source block belongs to every face. While other faces exist (`shared`),
 * no source block is dropped and no sentence is removed for being blank: the
 * other ledgers still hold those blocks.
 */
function tidy(page: FacePage, unitIds: Iterable<string>, newId: () => string, seed: TextStyle, shared: boolean) {
  for (const uid of new Set(unitIds)) {
    const unit = page.units.find((u) => u.id === uid)
    if (!unit) continue
    for (const side of ['source', 'translation'] as const) {
      const ofSide = unit.members.filter((id) => sideOfBlock(page, id) === side)
      const real = ofSide.filter((id) => !isBlank(page, id))
      if (real.length) {
        for (const id of ofSide.filter((m) => !real.includes(m))) {
          if (side === 'source' && shared) continue
          unit.members = unit.members.filter((m) => m !== id)
          dropBlock(page, id)
        }
      } else if (!ofSide.length) {
        const near = unit.members.map((id) => findTextObject(page.layers, id)).find((b): b is TextLayerEntry => !!b)
        const blank = side === 'source' ? blankSourceBlock(newId(), seed) : blankTranslationBlock(newId(), page.face, seed)
        if (near) {
          blank.body.x = near.body.x
          blank.body.y = near.body.y
        }
        const path = near ? pathOf(page.layers, near.id) : null
        if (!path || !insertAtPath(page.layers, [...path.slice(0, -1), path[path.length - 1]! + 1], blank))
          page.layers.push(blank)
        if (side === 'source') unit.members.unshift(blank.id)
        else unit.members.push(blank.id)
      }
    }
    if (!shared && unit.members.every((id) => isBlank(page, id))) {
      for (const id of unit.members) dropBlock(page, id)
      page.units = page.units.filter((u) => u.id !== uid)
    }
  }
}

/**
 * Ctrl+L, written into `page` in place. Returns false when there was nothing to
 * do. `shared` says other faces exist, whose ledgers still hold this page's
 * source blocks.
 */
export function relink(
  page: FacePage,
  selected: readonly string[],
  newId: () => string,
  seed: TextStyle,
  shared = false,
): boolean {
  const plan = planRelink(page, selected)
  if (plan.kind === 'none') return false
  const main = page.units.find((u) => u.id === plan.main)
  if (!main) return false
  const touched = new Set([plan.main, ...plan.moving.map((id) => placeOfBlock(page, id)?.unit.id ?? '')])
  const places = placesOf(page, touched)
  for (const id of plan.moving) moveBlock(page, id, main)

  if (plan.kind === 'join') {
    for (const uid of plan.folded) {
      page.units = page.units.filter((u) => u.id !== uid)
      touched.delete(uid)
    }
  }
  tidy(page, touched, newId, seed, shared)
  keepPlaces(page, places)
  return true
}

/** Where each sentence reads now: the first of its words in the page's order. */
function placesOf(page: FacePage, unitIds: Iterable<string>): Map<string, string> {
  const order = sourceOrder(page.manifest)
  const out = new Map<string, string>()
  for (const uid of unitIds) {
    const unit = page.units.find((u) => u.id === uid)
    const first = unit && order.find((id) => unit.members.includes(id))
    if (first !== undefined) out.set(uid, first)
  }
  return out
}

/**
 * A sentence that lost every word it read by, and got a blank one instead,
 * reads that blank where its first word stood — or it would fall to the end
 * of the page, where words nobody has placed read.
 */
function keepPlaces(page: FacePage, places: ReadonlyMap<string, string>): void {
  for (const [uid, first] of places) {
    const unit = page.units.find((u) => u.id === uid)
    if (!unit || unit.members.includes(first)) continue
    const named = new Set(page.manifest.readingOrder)
    const blanks = unit.members.filter((id) => !named.has(id) && sourceOrder(page.manifest).includes(id))
    if (blanks.length === 0) continue
    const order = sourceOrder(page.manifest).filter((id) => !blanks.includes(id))
    const at = order.indexOf(first)
    order.splice(at === -1 ? order.length : at, 0, ...blanks)
    page.manifest.readingOrder = order
  }
}

/**
 * Ctrl+Shift+L: the selected blocks leave for a sentence of their own, standing
 * where they are, read right after the first sentence they came from.
 */
export function detach(
  page: FacePage,
  selected: readonly string[],
  newId: () => string,
  seed: TextStyle,
  shared = false,
): boolean {
  const places = selected.map((id) => ({ id, place: placeOfBlock(page, id) })).filter((p) => p.place)
  if (!places.length) return false
  const from = new Set(places.map((p) => p.place!.unit.id))
  // Taking every block of the one sentence they share leaves it where it was.
  const only = from.size === 1 ? page.units.find((u) => from.has(u.id)) : undefined
  if (only && only.members.every((id) => selected.includes(id))) return false
  const unit: TranslationUnit = { id: newId(), members: [] }
  const after = firstInOrder(page, from)
  const kept = placesOf(page, from)
  page.units.push(unit)
  for (const { id } of places) moveBlock(page, id, unit)
  tidy(page, [...from, unit.id], newId, seed, shared)
  keepPlaces(page, kept)
  const behind = page.units.find((u) => u.id === after)
  if (behind) readAfter(page.manifest, unit.members, behind.members)
  return true
}

/**
 * Gives every face a sentence for any source block its ledger does not hold —
 * one a regroup in another face had to create — standing on that block with a
 * blank of the face's own lettering, read last.
 */
export function adoptSources(manifest: ManifestJson, faces: readonly string[], newId: () => string, seed: TextStyle): void {
  const sources = textObjects(manifest.layers).filter((t) => t.side === 'source')
  for (const face of faces) {
    const page = facePage(manifest, face)
    const held = new Set(page.units.flatMap((u) => u.members))
    for (const source of sources) {
      if (held.has(source.id)) continue
      const lettering = blankTranslationBlock(newId(), face, seed)
      lettering.body.x = source.body.x
      lettering.body.y = source.body.y
      manifest.layers.push(lettering)
      const unit = { id: newId(), members: [source.id, lettering.id] }
      page.units.push(unit)
    }
  }
}
