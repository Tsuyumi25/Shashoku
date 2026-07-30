import type { StyleGroup } from '@shared/project/types'
import type { TextStyle } from '@shared/text-style/types'
import type { ManifestJson } from '@shared/page/types'
import {
  pageStack,
  type RasterStackNode,
  type StackNode,
  type TextStackNode,
} from '@shared/page/stack'
import { textOf } from '@shared/page/text'
import { percentToContentPx } from '@/lib/coords'
import { labelBoxSize } from '@/lib/labelBox'
import { rasterFor } from '@/lib/labelRaster'
import { sampleSource } from '@/lib/fontSampleCache'
import { resolveTextStyle } from '@/lib/textStyle'

/**
 * A page that cannot be drawn faithfully. Never swallowed: the whole point of
 * looking at composited pages before an export is to find out that page 47 is
 * wrong, and a page quietly missing its text would say the opposite.
 */
export class CompositeError extends Error {}

export interface CompositeInput {
  /** The raw page as it sits in the project's own copy. */
  raw: Uint8Array
  page: ManifestJson
  groups: readonly StyleGroup[]
  defaultStyle: TextStyle
  /**
   * One raster layer's PNG, by the file name the manifest holds. A loader
   * rather than a bag of bytes so that the caller only has to say where layers
   * live, and this decides which of them the page actually needs.
   */
  loadLayer(file: string): Promise<Uint8Array>
}

interface Size {
  w: number
  h: number
}

/**
 * The allowlist is the CSS blend-mode vocabulary on purpose, which canvas takes
 * verbatim — `normal` being the one name the two media spell differently.
 */
function canvasBlend(mode: string): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : (mode as GlobalCompositeOperation)
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CompositeError('OffscreenCanvas 2d context unavailable')
  return ctx
}

/** A layer with no frame yet has nothing to draw and no file worth reading. */
function hasPixels(node: RasterStackNode): boolean {
  return node.entry.w > 0 && node.entry.h > 0
}

function rasterNodes(nodes: readonly StackNode[]): RasterStackNode[] {
  const out: RasterStackNode[] = []
  for (const node of nodes) {
    if (node.kind === 'raster') out.push(node)
    else if (node.kind === 'buffer') out.push(...rasterNodes(node.children))
  }
  return out
}

/**
 * Every raster the page draws, decoded once each and handed back for closing.
 * A file the manifest names but the disk does not have stops the composite —
 * delivering the page with a patch missing would look like a finished page.
 */
async function decodeRasters(
  stack: readonly StackNode[],
  load: CompositeInput['loadLayer'],
  opened: ImageBitmap[],
): Promise<Map<string, ImageBitmap>> {
  const wanted = [...new Set(rasterNodes(stack).filter(hasPixels).map((n) => n.entry.file))]
  const decoded = new Map<string, ImageBitmap>()
  for (const file of wanted) {
    try {
      const bitmap = await createImageBitmap(new Blob([(await load(file)) as BlobPart]))
      opened.push(bitmap)
      decoded.set(file, bitmap)
    } catch (err) {
      throw new CompositeError(
        `無法讀取圖層「${file}」:${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return decoded
}

function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  node: TextStackNode,
  size: Size,
  input: CompositeInput,
): void {
  const label = node.entry
  const text = textOf(label)
  if (text.length === 0) return
  const style = resolveTextStyle(label, input.groups, input.defaultStyle)
  const raster = rasterFor(text, style)
  if (!raster.ok) throw new CompositeError(raster.reason || `無法繪製標籤「${text}」`)
  const box = labelBoxSize(style, raster.sample.image)
  const anchor = percentToContentPx(label.x, label.y, size.w, size.h)

  ctx.translate(anchor.x, anchor.y)
  ctx.rotate(label.rotation)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sampleSource(raster.sample), -box.w / 2, -box.h / 2, box.w, box.h)
}

function drawStack(
  ctx: OffscreenCanvasRenderingContext2D,
  nodes: readonly StackNode[],
  size: Size,
  rasters: ReadonlyMap<string, ImageBitmap>,
  input: CompositeInput,
): void {
  for (const node of nodes) {
    ctx.save()
    ctx.globalAlpha = node.opacity
    ctx.globalCompositeOperation = canvasBlend(node.blendMode)
    if (node.kind === 'raster') {
      const bitmap = rasters.get(node.entry.file)
      if (bitmap) {
        const { x, y, w, h } = node.entry
        ctx.drawImage(bitmap, x, y, w, h)
      }
    } else if (node.kind === 'text') {
      drawText(ctx, node, size, input)
    } else {
      // A folder with blending of its own has to become one picture before that
      // blending can apply, which is the buffer the pass-through default avoids.
      const buffer = new OffscreenCanvas(size.w, size.h)
      drawStack(context2d(buffer), node.children, size, rasters, input)
      ctx.drawImage(buffer, 0, 0)
    }
    ctx.restore()
  }
}

/**
 * One page as it will be delivered: the raw with its layers and its typeset
 * text burnt in, at the raw's own size.
 *
 * Deliberately built from the same stacking order, the same rasterizer, the
 * same resolved style and the same box geometry the canvas draws with, so what
 * comes out of here matching what is on screen is a property of the code rather
 * than something anyone has to keep true. Resizing is a separate step for the
 * same reason — one clean downsample of the finished page, rather than a second
 * set of rules for where text lands at another scale.
 */
export async function compositePage(input: CompositeInput): Promise<OffscreenCanvas> {
  const opened: ImageBitmap[] = []
  try {
    const bitmap = await createImageBitmap(new Blob([input.raw as BlobPart]))
    opened.push(bitmap)
    const size = { w: bitmap.width, h: bitmap.height }
    const stack = pageStack(input.page.layers)
    const rasters = await decodeRasters(stack, input.loadLayer, opened)

    const canvas = new OffscreenCanvas(size.w, size.h)
    const ctx = context2d(canvas)
    ctx.drawImage(bitmap, 0, 0)
    drawStack(ctx, stack, size, rasters, input)
    return canvas
  } finally {
    for (const bitmap of opened) bitmap.close()
  }
}

/** Longest edge fitted to `edge`, aspect kept. A page already smaller is left alone. */
export function fitWithin(
  size: { w: number; h: number },
  edge: number,
): { w: number; h: number } {
  const longest = Math.max(size.w, size.h)
  if (longest <= edge) return { w: size.w, h: size.h }
  const ratio = edge / longest
  return { w: Math.max(1, Math.round(size.w * ratio)), h: Math.max(1, Math.round(size.h * ratio)) }
}

export function resizeCanvas(source: OffscreenCanvas, w: number, h: number): OffscreenCanvas {
  if (source.width === w && source.height === h) return source
  const out = new OffscreenCanvas(w, h)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = true
  // Screentones and hairlines are exactly what a cheap downsample destroys, and
  // exactly what someone checking a page before delivery is looking at.
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return out
}
