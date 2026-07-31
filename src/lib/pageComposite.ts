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
import { smoothingQualityFor } from '@/lib/coords'
import { drawnLabel } from '@/lib/labelRaster'
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

export function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CompositeError('OffscreenCanvas 2d context unavailable')
  return ctx
}

/**
 * The bytes a layer file is written from. Shared by everything that puts new
 * pixels on a page — filling a selection, merging a stack, baking a transform —
 * so those three cannot end up writing three subtly different PNGs.
 */
export async function encodePng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** A layer with no frame yet has nothing to draw and no file worth reading. */
export function hasPixels(node: RasterStackNode): boolean {
  return node.entry.w > 0 && node.entry.h > 0
}

export function rasterNodes(nodes: readonly StackNode[]): RasterStackNode[] {
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
export async function decodeLayerBitmaps(
  stack: readonly StackNode[],
  load: (file: string) => Promise<Uint8Array>,
): Promise<Map<string, ImageBitmap>> {
  const wanted = [...new Set(rasterNodes(stack).filter(hasPixels).map((n) => n.entry.file))]
  const decoded = new Map<string, ImageBitmap>()
  try {
    for (const file of wanted) {
      decoded.set(file, await createImageBitmap(new Blob([(await load(file)) as BlobPart])))
    }
  } catch (err) {
    for (const bitmap of decoded.values()) bitmap.close()
    throw new CompositeError(
      `無法讀取圖層:${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return decoded
}

function drawTextWith(
  ctx: OffscreenCanvasRenderingContext2D,
  node: TextStackNode,
  input: CompositeInput,
): void {
  const label = node.entry
  const text = textOf(label)
  if (text.length === 0) return
  const style = resolveTextStyle(label, input.groups, input.defaultStyle)
  const drawn = drawnLabel(text, style, { x: label.x, y: label.y })
  // A family this machine lacks draws notdef boxes rather than nothing, so the
  // only way to arrive here without a bitmap is a catalogue that never
  // answered. Exporting the page short one label silently would be worse than
  // stopping, since the file would look finished.
  if (!drawn.sample) throw new CompositeError(`字型目錄尚未就緒，無法匯出標籤「${text}」`)

  const { box } = drawn
  ctx.translate(drawn.center.x, drawn.center.y)
  ctx.rotate(label.rotation)
  ctx.imageSmoothingEnabled = true
  // The frame is the bitmap's own size, so the ratio is 1 by construction and a
  // rotation is the only thing left here to resample. Still through the shared
  // rule, so one bitmap cannot be filtered two ways.
  ctx.imageSmoothingQuality = smoothingQualityFor(1)
  ctx.drawImage(sampleSource(drawn.sample), -box.w / 2, -box.h / 2, box.w, box.h)
}

/**
 * What a stack needs to be drawn with, whichever surface is drawing it.
 *
 * Shared so that merging several layers into one and compositing a whole page
 * are the same code reading the same order — the two would otherwise be two
 * answers to "what does this stack look like", free to drift.
 */
export interface StackPaint {
  /**
   * The page's own size. A folder that needs a buffer gets one this big, so
   * that everything inside it stays in page coordinates.
   */
  page: Size
  rasters: ReadonlyMap<string, ImageBitmap>
  /** How a text object is drawn. Merge never has one and refuses instead. */
  drawText(ctx: OffscreenCanvasRenderingContext2D, node: TextStackNode): void
}

/**
 * A stack onto a context already in page coordinates — the caller decides where
 * the origin is, which is what lets a merge draw into its own frame.
 */
export function drawStack(
  ctx: OffscreenCanvasRenderingContext2D,
  nodes: readonly StackNode[],
  paint: StackPaint,
): void {
  for (const node of nodes) {
    ctx.save()
    ctx.globalAlpha = node.opacity
    ctx.globalCompositeOperation = canvasBlend(node.blendMode)
    if (node.kind === 'raster') {
      const bitmap = paint.rasters.get(node.entry.file)
      if (bitmap) {
        const { x, y, w, h } = node.entry
        ctx.drawImage(bitmap, x, y, w, h)
      }
    } else if (node.kind === 'text') {
      paint.drawText(ctx, node)
    } else {
      // A folder with blending of its own has to become one picture before that
      // blending can apply, which is the buffer the pass-through default avoids.
      //
      // Always page-sized and drawn in page coordinates, so whatever offset this
      // context carries is applied once — when the finished buffer lands — and
      // never again inside it.
      const buffer = new OffscreenCanvas(paint.page.w, paint.page.h)
      drawStack(context2d(buffer), node.children, paint)
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
  const page = await createImageBitmap(new Blob([input.raw as BlobPart]))
  const size = { w: page.width, h: page.height }
  const stack = pageStack(input.page.layers)
  const rasters = await decodeLayerBitmaps(stack, input.loadLayer).catch((err: unknown) => {
    page.close()
    throw err
  })
  try {
    const canvas = new OffscreenCanvas(size.w, size.h)
    const ctx = context2d(canvas)
    ctx.drawImage(page, 0, 0)
    drawStack(ctx, stack, {
      page: size,
      rasters,
      drawText: (target, node) => drawTextWith(target, node, input),
    })
    return canvas
  } finally {
    page.close()
    for (const bitmap of rasters.values()) bitmap.close()
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
