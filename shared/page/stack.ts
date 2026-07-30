import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from './types'
import { PASS_THROUGH } from './types'

/**
 * How a page stacks, answered once.
 *
 * The canvas, the export compositor and the thumbnails all draw the same page
 * and have to agree about what goes over what — but none of them draws it the
 * same way: the canvas places screen-scale elements, the compositor writes into
 * a full-resolution buffer. What they can share is this, the order and the
 * blending, so the thing that could drift is computed in one place and the
 * drawing is left to each of them.
 */

interface StackNodeBase {
  /** Already resolved: never `PASS_THROUGH`, which is a containment rule rather than a way to draw. */
  blendMode: string
  opacity: number
}

export interface RasterStackNode extends StackNodeBase {
  kind: 'raster'
  entry: RasterLayerEntry
}

export interface TextStackNode extends StackNodeBase {
  kind: 'text'
  entry: TextLayerEntry
}

/**
 * A folder whose contents have to become one picture before its own blending
 * can apply — an offscreen buffer, in whatever form the consumer's medium takes.
 */
export interface BufferStackNode extends StackNodeBase {
  kind: 'buffer'
  entry: GroupLayerEntry
  children: StackNode[]
}

export type StackNode = RasterStackNode | TextStackNode | BufferStackNode

/**
 * Whether a folder costs a buffer. Pass-through at full opacity is the one case
 * that does not, which is why it is the default a new folder gets: an ordinary
 * folder is pure containment and should cost nothing to draw.
 */
function needsBuffer(folder: GroupLayerEntry): boolean {
  return folder.blendMode !== PASS_THROUGH || folder.opacity !== 1
}

/**
 * The page as it is drawn, bottom first.
 *
 * Hiding is inherited: a folder that is off takes everything under it with it,
 * whatever those objects say about themselves. A folder that needs no buffer
 * disappears into whatever holds it, so the common page comes back flat.
 */
export function pageStack(layers: readonly LayerEntry[]): StackNode[] {
  const out: StackNode[] = []
  for (const entry of layers) {
    if (!entry.visible) continue
    if (entry.kind === 'raster') {
      out.push({ kind: 'raster', entry, opacity: entry.opacity, blendMode: entry.blendMode })
      continue
    }
    if (entry.kind === 'text') {
      out.push({ kind: 'text', entry, opacity: entry.opacity, blendMode: entry.blendMode })
      continue
    }
    const children = pageStack(entry.children)
    if (!needsBuffer(entry)) {
      out.push(...children)
      continue
    }
    // A buffer with nothing in it draws nothing, and every consumer would
    // otherwise have to allocate one to find that out.
    if (children.length === 0) continue
    out.push({
      kind: 'buffer',
      entry,
      children,
      opacity: entry.opacity,
      blendMode: entry.blendMode === PASS_THROUGH ? 'normal' : entry.blendMode,
    })
  }
  return out
}

/** Every text object that will be drawn, in drawing order, buffers walked into. */
export function stackedTextNodes(nodes: readonly StackNode[]): TextStackNode[] {
  const out: TextStackNode[] = []
  for (const node of nodes) {
    if (node.kind === 'text') out.push(node)
    else if (node.kind === 'buffer') out.push(...stackedTextNodes(node.children))
  }
  return out
}

/**
 * Every raster layer that will be drawn, in drawing order, buffers walked into.
 *
 * Read from the stack rather than the tree because that is what makes hiding
 * inherited here too: a layer inside a folder that is off is not on the page,
 * and a frame around it would be a handle on nothing.
 */
export function stackedRasterNodes(nodes: readonly StackNode[]): RasterStackNode[] {
  const out: RasterStackNode[] = []
  for (const node of nodes) {
    if (node.kind === 'raster') out.push(node)
    else if (node.kind === 'buffer') out.push(...stackedRasterNodes(node.children))
  }
  return out
}
