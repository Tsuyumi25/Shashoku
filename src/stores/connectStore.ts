import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { hasEdge, wouldCycle, type ReadingEdge } from '@shared/page/readingGraph'
import type { Point } from '@/lib/labelBox'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A chain being drawn: where the next link starts from, what has been laid so
 * far, and where the pointer is holding the loose end.
 */
export interface ConnectGesture {
  page: string
  /** Where the next link starts. Moves on to each object the chain reaches. */
  source: string
  /** Laid so far, in the order they were drawn. */
  links: ReadingEdge[]
  /** Links taken back inside this chain, so it can redo its own. */
  undone: ReadingEdge[]
  /** The loose end, in page pixels — where the preview runs to. */
  at: Point
}

/**
 * Drawing the reading onto the page, one chain at a time.
 *
 * Click to set out, click again to arrive; a preview line follows the pointer
 * between the two, and the chain carries on from wherever it last landed. The
 * button is never held while the pointer travels, which is what makes it steady
 * on a page of a dozen bubbles — every step can be stopped and looked at, and
 * a wrong one costs one more click rather than a whole drag landed in the
 * wrong place.
 *
 * ⚠️ Deliberately unlike the reference this borrows its numbers from, which
 * drops back to the pointer tool after every single line. The task is a
 * different shape: a whiteboard's connections are sparse, and a page's reading
 * is one long chain down a dozen objects — one line per trip to the tool rail
 * would mean a dozen trips a page.
 *
 * The lifecycle is the polygon lasso's, because it is the same shape of
 * problem — a run of separate actions accumulating into one thing. A chain
 * under way is tool state and the page is not touched until it is committed,
 * which is what makes cancelling one — by Escape, by changing tool, by turning
 * the page — always clean. It has its own undo and redo, so Ctrl+Z inside a
 * chain takes back a link rather than reaching past the chain into the
 * document. And the commit is one command however many links it laid.
 */
export const useConnectStore = defineStore('connect', () => {
  const gesture = shallowRef<ConnectGesture | null>(null)

  /**
   * The line under the cursor's attention, so Delete has something to act on.
   * Tool state and nothing else: which line is being looked at is not something
   * the page has an opinion about.
   */
  const selected = shallowRef<{ page: string; edge: ReadingEdge } | null>(null)

  const isDrawing = computed(() => gesture.value !== null)
  const links = computed<readonly ReadingEdge[]>(() => gesture.value?.links ?? [])

  /**
   * What a refusal is judged against: the page's own lines plus the ones this
   * chain has laid but not yet committed. Both, because a chain can close a
   * ring against itself just as easily as against what was already there.
   */
  function standing(): ReadingEdge[] {
    const g = gesture.value
    if (g === null) return []
    return [...useProjectStore().readingEdgesOf(g.page), ...g.links]
  }

  /**
   * Whether the chain cannot reach this object. Asked while the pointer is
   * still moving, so a target that will be refused is drawn as refused instead
   * of the refusal being reported after the click.
   */
  function refuses(targetId: string): boolean {
    const g = gesture.value
    if (g === null) return true
    // Where an object is read is one of the things a lock is put on to hold
    // still, and a line is a statement about exactly that.
    const editor = useEditorStore()
    if (editor.isLayerLocked(g.source) || editor.isLayerLocked(targetId)) return true
    return wouldCycle(standing(), { from: g.source, to: targetId })
  }

  function begin(page: string, sourceId: string, at: Point): void {
    selected.value = null
    gesture.value = { page, source: sourceId, links: [], undone: [], at }
  }

  function track(at: Point): void {
    const g = gesture.value
    if (g === null) return
    gesture.value = { ...g, at }
  }

  /**
   * Arrive at the next object. False means the chain refused to go there.
   *
   * Arriving somewhere a line already reaches adds nothing and still moves the
   * source on: walking along part of a chain is how you carry on from the
   * middle of it, not a mistake to refuse.
   */
  function reach(targetId: string): boolean {
    const g = gesture.value
    if (g === null || refuses(targetId)) return false
    const edge = { from: g.source, to: targetId }
    const laid = hasEdge(standing(), edge) ? g.links : [...g.links, edge]
    gesture.value = { ...g, source: targetId, links: laid, undone: [] }
    return true
  }

  function cancel(): void {
    if (gesture.value === null) return
    gesture.value = null
  }

  /** Everything this tool was holding — for leaving the tool, or the page. */
  function reset(): void {
    gesture.value = null
    selected.value = null
  }

  /**
   * The one moment the page is written to, and it is one entry on the stack.
   * A chain that laid nothing simply ends — there is nothing to record, and an
   * entry that undoes to nothing is worse than none.
   */
  function commit(): void {
    const g = gesture.value
    gesture.value = null
    if (g === null || g.links.length === 0) return
    useEditorStore().cmdDrawReadingEdges(g.page, g.links)
  }

  /**
   * Ctrl+Z inside a chain takes back a link, and reports that it did so.
   * Running out cancels the whole chain rather than reaching past it: an
   * unfinished chain is not in the document, so letting the key through would
   * undo whatever came before while the half-drawn chain sat there untouched.
   */
  function gestureUndo(): boolean {
    const g = gesture.value
    if (g === null) return false
    const last = g.links[g.links.length - 1]
    if (last === undefined) {
      cancel()
      return true
    }
    gesture.value = {
      ...g,
      source: last.from,
      links: g.links.slice(0, -1),
      undone: [...g.undone, last],
    }
    return true
  }

  /**
   * Redo from the first day. Half of it is worse than none: every editor that
   * added in-gesture undo without it left a key that visibly loses work.
   */
  function gestureRedo(): boolean {
    const g = gesture.value
    if (g === null) return false
    const back = g.undone[g.undone.length - 1]
    if (back === undefined) return true
    gesture.value = {
      ...g,
      source: back.to,
      links: [...g.links, back],
      undone: g.undone.slice(0, -1),
    }
    return true
  }

  function select(page: string, edge: ReadingEdge | null): void {
    selected.value = edge === null ? null : { page, edge }
  }

  function deselect(): void {
    selected.value = null
  }

  /** False when nothing is chosen, so the key that asked can fall through. */
  function eraseSelected(): boolean {
    const held = selected.value
    if (held === null) return false
    selected.value = null
    useEditorStore().cmdEraseReadingEdges(held.page, [held.edge])
    return true
  }

  return {
    gesture,
    selected,
    isDrawing,
    links,
    refuses,
    begin,
    track,
    reach,
    cancel,
    reset,
    commit,
    gestureUndo,
    gestureRedo,
    select,
    deselect,
    eraseSelected,
  }
})
