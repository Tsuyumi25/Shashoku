import type {
  BufferStackNode,
  RasterStackNode,
  StackNode,
  TextStackNode,
} from '@shared/page/stack'

/** Anything that draws as a bitmap at a place on the page. */
export type RunStackNode = RasterStackNode | TextStackNode

/**
 * One element of the canvas's DOM, which is how the canvas expresses stacking:
 * the browser already composites siblings in order, so the panel does not need
 * a compositor of its own — only the right elements in the right order.
 */
export type StackSegment =
  | { kind: 'run'; key: string; blendMode: string; nodes: RunStackNode[] }
  | { kind: 'buffer'; key: string; blendMode: string; node: BufferStackNode }

/**
 * The stack cut into the elements that will draw it.
 *
 * Neighbours share one canvas, which is the whole point: a canvas here is
 * viewport-sized, tens of megabytes at a retina scale, and a page erased one
 * region at a time would otherwise ask for one per patch.
 *
 * What decides the element count is the blend mode, not the kind of object. A
 * blend mode reads the backdrop, and a shared canvas does not have the page in
 * it — so anything that blends is given an element of its own, where CSS can
 * blend it against what is really underneath. Opacity has no such trouble:
 * drawing at that alpha into the shared canvas and letting the canvas land
 * normally is the same picture. Text has no reason of its own to be separate,
 * and giving it one cost a viewport-sized canvas for every label on the page.
 *
 * `alone` is the second reason to break a run: a layer under a gesture is drawn
 * at an offset of its own, and a canvas it shares would carry its neighbours
 * along with it; a layer under a stroke has that stroke composited onto it, and
 * an eraser sharing a canvas would punch through its neighbours. Only for as
 * long as those last — the decoded layers are held above this, so a re-cut is a
 * rearrangement of pixels that are already there and selecting a layer has no
 * reason to move anything.
 *
 * A set rather than one id, because the two outlive each other: a stroke's
 * write waits on a handover, and a hand that lets go and grabs a different
 * layer in that window would otherwise put the layer it had just painted back
 * into a shared run and take the paint off screen until the write landed.
 */
export function stackSegments(
  nodes: readonly StackNode[],
  alone: ReadonlySet<string> = new Set(),
): StackSegment[] {
  const out: StackSegment[] = []
  for (const node of nodes) {
    if (node.kind === 'buffer') {
      out.push({ kind: 'buffer', key: node.entry.id, blendMode: node.blendMode, node })
      continue
    }
    const last = out[out.length - 1]
    const held = alone.has(node.entry.id)
    if (
      !held &&
      node.blendMode === 'normal' &&
      last !== undefined &&
      last.kind === 'run' &&
      last.blendMode === 'normal' &&
      // A run that ended on a held layer stays closed; joining it would put the
      // neighbour back under whatever the split exists to keep off it.
      !alone.has(last.nodes[0].entry.id)
    ) {
      last.nodes.push(node)
      continue
    }
    out.push({ kind: 'run', key: node.entry.id, blendMode: node.blendMode, nodes: [node] })
  }
  return out
}
