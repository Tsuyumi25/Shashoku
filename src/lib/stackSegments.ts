import type {
  BufferStackNode,
  RasterStackNode,
  StackNode,
  TextStackNode,
} from '@shared/page/stack'

/**
 * One element of the canvas's DOM, which is how the canvas expresses stacking:
 * the browser already composites siblings in order, so the panel does not need
 * a compositor of its own — only the right elements in the right order.
 */
export type StackSegment =
  | { kind: 'rasters'; key: string; blendMode: string; nodes: RasterStackNode[] }
  | { kind: 'text'; key: string; blendMode: string; node: TextStackNode }
  | { kind: 'buffer'; key: string; blendMode: string; node: BufferStackNode }

/**
 * The stack cut into the elements that will draw it.
 *
 * Neighbouring rasters share one canvas, which is the whole point: a canvas
 * here is viewport-sized, tens of megabytes at a retina scale, and a page
 * erased one region at a time would otherwise ask for one per patch.
 *
 * Only rasters that blend normally can share. A blend mode reads the backdrop,
 * and a shared canvas does not have the page in it — so one that blends is
 * given an element of its own where CSS can blend it against what is really
 * underneath. Opacity has no such trouble: drawing at that alpha into the
 * shared canvas and letting the canvas land normally is the same picture.
 *
 * `alone` is the second reason to break a run: a layer that can be dragged is
 * drawn at an offset of its own, and a canvas it shares would carry its
 * neighbours along with it. It is held aside from the moment it is selected
 * rather than from the moment it is grabbed, because re-cutting the page under
 * a pointer that is already moving makes the neighbouring canvases remount and
 * fetch their layers again — a blink at exactly the wrong time.
 */
export function stackSegments(
  nodes: readonly StackNode[],
  alone: string | null = null,
): StackSegment[] {
  const out: StackSegment[] = []
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push({ kind: 'text', key: node.entry.id, blendMode: node.blendMode, node })
      continue
    }
    if (node.kind === 'buffer') {
      out.push({ kind: 'buffer', key: node.entry.id, blendMode: node.blendMode, node })
      continue
    }
    const last = out[out.length - 1]
    const held = node.entry.id === alone
    if (
      !held &&
      node.blendMode === 'normal' &&
      last !== undefined &&
      last.kind === 'rasters' &&
      last.blendMode === 'normal' &&
      // A run that ended on the held layer stays closed; joining it would put
      // the neighbour back under the transform the split exists to keep off it.
      last.nodes[0].entry.id !== alone
    ) {
      last.nodes.push(node)
      continue
    }
    out.push({ kind: 'rasters', key: node.entry.id, blendMode: node.blendMode, nodes: [node] })
  }
  return out
}
