import type { TextStyle } from '../text-style/types'
import type { ManifestJson, TextLayerEntry, TranslationUnit, TranslationUnitSide } from './types'
import type { TextSide } from './text'
import { normalizeEdges } from './readingGraph'
import { blankBlock } from './schema'
import { findTextObject, insertAtPath, pathOf, removeAtPath } from './tree'
import { placeOfBlock, shownCodeOf } from './units'

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
 */
export type RelinkPlan =
  | { kind: 'join'; main: string; folded: string[]; moving: string[] }
  | { kind: 'pair'; main: string; moving: string[] }
  | { kind: 'none' }

const sideOf = (unit: TranslationUnit, side: TextSide): TranslationUnitSide =>
  side === 'source' ? unit.source : unit.translation

function firstInOrder(page: ManifestJson, units: Iterable<string>): string | undefined {
  const wanted = new Set(units)
  return page.readingOrder.find((id) => wanted.has(id)) ?? [...wanted][0]
}

export function planRelink(page: ManifestJson, selected: readonly string[]): RelinkPlan {
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
    const moving = page.translationUnits
      .filter((u) => folded.includes(u.id))
      .flatMap((u) => [...u.source.members, ...u.translation.members])
    return { kind: 'join', main, folded, moving }
  }

  const main = firstInOrder(page, places.filter((p) => p.place.side === 'source').map((p) => p.place.unit.id))!
  const moving = places.filter((p) => p.place.unit.id !== main).map((p) => p.id)
  return moving.length ? { kind: 'pair', main, moving } : { kind: 'none' }
}

/** Shown text decides blankness, so a block whose words live in the chosen proposal is not blank. */
function isBlank(page: ManifestJson, id: string): boolean {
  const block = findTextObject(page.layers, id)
  return !block || shownCodeOf(page, block).trim() === ''
}

/**
 * A proposal is pointed at only while it has one piece per translation block.
 * A unit whose translation is about to change shape writes what it shows into
 * its own blocks first and stops pointing, so no word is lost and the pool keeps
 * every proposal for picking again.
 */
function settleChosen(page: ManifestJson, unit: TranslationUnit) {
  const chosen = unit.candidates.find((c) => c.id === unit.chosen)
  if (chosen && chosen.pieces.length === unit.translation.members.length) {
    unit.translation.members.forEach((id, at) => {
      const block = findTextObject(page.layers, id)
      if (block) block.body.lines = [...(chosen.pieces[at] ?? [''])]
    })
  }
  unit.chosen = null
}

function takeOut(list: TranslationUnitSide, id: string) {
  const at = list.members.indexOf(id)
  if (at === -1) return
  list.members.splice(at, 1)
  list.separators.splice(Math.max(0, at - 1), 1)
}

function putIn(list: TranslationUnitSide, id: string) {
  if (list.members.length) list.separators.push('')
  list.members.push(id)
}

function dropBlock(page: ManifestJson, id: string) {
  const path = pathOf(page.layers, id)
  if (path) removeAtPath(page.layers, path)
}

/**
 * A side that has real words loses its blank placeholders; a side left with
 * nothing gets one, standing where the sentence's other blocks stand; a unit
 * left with nothing but blanks is gone, with its place in the reading and its
 * lines.
 */
function tidy(page: ManifestJson, unitIds: Iterable<string>, newId: () => string, seed: TextStyle) {
  for (const uid of new Set(unitIds)) {
    const unit = page.translationUnits.find((u) => u.id === uid)
    if (!unit) continue
    for (const side of ['source', 'translation'] as const) {
      const list = sideOf(unit, side)
      const real = list.members.filter((id) => !isBlank(page, id))
      if (real.length) {
        for (const id of list.members.filter((m) => !real.includes(m))) {
          takeOut(list, id)
          dropBlock(page, id)
        }
      } else if (!list.members.length) {
        const near = [...unit.source.members, ...unit.translation.members]
          .map((id) => findTextObject(page.layers, id))
          .find((b): b is TextLayerEntry => !!b)
        const blank: TextLayerEntry = side === 'source' ? blankBlock(newId(), 'source', seed) : blankBlock(newId(), 'translation', seed)
        if (near) {
          blank.body.x = near.body.x
          blank.body.y = near.body.y
        }
        const path = near ? pathOf(page.layers, near.id) : null
        if (!path || !insertAtPath(page.layers, [...path.slice(0, -1), path[path.length - 1]! + 1], blank))
          page.layers.push(blank)
        putIn(list, blank.id)
      }
    }
    const all = [...unit.source.members, ...unit.translation.members]
    if (all.every((id) => isBlank(page, id))) {
      all.forEach((id) => dropBlock(page, id))
      page.translationUnits = page.translationUnits.filter((u) => u.id !== uid)
      page.readingOrder = page.readingOrder.filter((id) => id !== uid)
      page.readingEdges = page.readingEdges.filter((e) => e.from !== uid && e.to !== uid)
    }
  }
}

function moveBlock(page: ManifestJson, id: string, to: TranslationUnit) {
  const place = placeOfBlock(page, id)
  if (!place || place.unit.id === to.id) return
  takeOut(sideOf(place.unit, place.side), id)
  putIn(sideOf(to, place.side), id)
}

/** The units whose translation side a set of moves changes. */
function reshaped(page: ManifestJson, main: string, moving: readonly string[]): TranslationUnit[] {
  const ids = new Set<string>()
  for (const id of moving) {
    const place = placeOfBlock(page, id)
    if (place?.side === 'translation') {
      ids.add(place.unit.id)
      ids.add(main)
    }
  }
  return page.translationUnits.filter((u) => ids.has(u.id))
}

/** Ctrl+L, written into `page` in place. Returns false when there was nothing to do. */
export function relink(page: ManifestJson, selected: readonly string[], newId: () => string, seed: TextStyle): boolean {
  const plan = planRelink(page, selected)
  if (plan.kind === 'none') return false
  const main = page.translationUnits.find((u) => u.id === plan.main)
  if (!main) return false
  const touched = new Set([plan.main, ...plan.moving.map((id) => placeOfBlock(page, id)?.unit.id ?? '')])
  reshaped(page, plan.main, plan.moving).forEach((u) => settleChosen(page, u))
  for (const id of plan.moving) moveBlock(page, id, main)

  if (plan.kind === 'join') {
    for (const uid of plan.folded) {
      const gone = page.translationUnits.find((u) => u.id === uid)
      if (!gone) continue
      // What was said about the sentence, and what was proposed for it, stays.
      main.tags = [...new Set([...main.tags, ...gone.tags])].sort()
      main.candidates.push(...gone.candidates)
      page.translationUnits = page.translationUnits.filter((u) => u.id !== uid)
      page.readingOrder = page.readingOrder.filter((id) => id !== uid)
      page.readingEdges = page.readingEdges.map((e) => ({
        from: e.from === uid ? plan.main : e.from,
        to: e.to === uid ? plan.main : e.to,
      }))
      touched.delete(uid)
    }
    page.readingEdges = normalizeEdges(page.readingEdges.filter((e) => e.from !== e.to))
  }
  tidy(page, touched, newId, seed)
  return true
}

/**
 * Ctrl+Shift+L: the selected blocks leave for a sentence of their own, standing
 * where they are, read right after the first sentence they came from.
 */
export function detach(page: ManifestJson, selected: readonly string[], newId: () => string, seed: TextStyle): boolean {
  const places = selected.map((id) => ({ id, place: placeOfBlock(page, id) })).filter((p) => p.place)
  if (!places.length) return false
  const from = new Set(places.map((p) => p.place!.unit.id))
  // Taking every block of the one sentence they share leaves it where it was.
  const only = from.size === 1 ? page.translationUnits.find((u) => from.has(u.id)) : undefined
  if (only && [...only.source.members, ...only.translation.members].every((id) => selected.includes(id))) return false
  const unit: TranslationUnit = {
    id: newId(),
    tags: [],
    source: { members: [], separators: [] },
    translation: { members: [], separators: [] },
    candidates: [],
    chosen: null,
  }
  const after = firstInOrder(page, from)
  page.translationUnits.push(unit)
  page.readingOrder.splice(after ? page.readingOrder.indexOf(after) + 1 : page.readingOrder.length, 0, unit.id)
  reshaped(page, unit.id, places.map((p) => p.id)).forEach((u) => settleChosen(page, u))
  for (const { id } of places) moveBlock(page, id, unit)
  tidy(page, [...from, unit.id], newId, seed)
  return true
}
