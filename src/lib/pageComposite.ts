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

/**
 * A page that cannot be drawn faithfully. Never swallowed: the whole point of
 * looking at composited pages before an export is to find out that page 47 is
 * wrong, and a page quietly missing its text would say the opposite.
 */
export class CompositeError extends Error {}

export interface CompositeInput {
  page: ManifestJson
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

function drawTextWith(ctx: OffscreenCanvasRenderingContext2D, node: TextStackNode): void {
  const label = node.entry
  const text = textOf(label)
  if (text.length === 0) return
  const drawn = drawnLabel(text, label.style, { x: label.x, y: label.y }, label.rotation)
  // A family this machine lacks draws notdef boxes rather than nothing, so the
  // only way to arrive here without a bitmap is a catalogue that never
  // answered. Exporting the page short one label silently would be worse than
  // stopping, since the file would look finished.
  if (!drawn.sample) throw new CompositeError(`字型目錄尚未就緒，無法匯出標籤「${text}」`)

  // The engine already turned the outline, so there is nothing left to rotate
  // here and nothing to resample: the bitmap lands one pixel per pixel.
  const { width, height } = drawn.sample.image
  ctx.translate(drawn.center.x, drawn.center.y)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = smoothingQualityFor(1)
  ctx.drawImage(sampleSource(drawn.sample), -width / 2, -height / 2)
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
 * One page as it will be delivered: its layers and its typeset text, at the
 * page's own size.
 *
 * Nothing is laid down first. The base map is a layer like any other, free to
 * be hidden, moved or deleted, so anywhere no layer covers is transparent —
 * there is no invisible sheet of white underneath that nobody could reach.
 * A delivery that cannot carry transparency is flattened onto white by the
 * encoder, which is where a format's limits belong.
 *
 * Deliberately built from the same stacking order, the same rasterizer, the
 * same style each object carries and the same box geometry the canvas draws with, so what
 * comes out of here matching what is on screen is a property of the code rather
 * than something anyone has to keep true. Resizing is a separate step for the
 * same reason — one clean downsample of the finished page, rather than a second
 * set of rules for where text lands at another scale.
 */
export async function compositePage(input: CompositeInput): Promise<OffscreenCanvas> {
  return await compositeWith(input, drawTextWith)
}

/**
 * The same page with the typesetting left off — every raster in its own place,
 * in stacking order, with nothing written on top.
 *
 * This is what the wand reads. It is there to find a shape in the artwork, and
 * a translation sitting inside a balloon is not part of that balloon, so text
 * is skipped rather than sampled around. Skipping it invents nothing: `text`
 * and `raster` are already two kinds in the stack.
 *
 * Compositing rather than picking a layer is the whole point. The base map has
 * no type of its own — it can be unlocked, reordered, dropped into a folder —
 * so "which layer is the artwork" has no answer to look up. "What is at this
 * point on the page" always does.
 */
export async function compositeArtwork(input: CompositeInput): Promise<OffscreenCanvas> {
  return await compositeWith(input, () => {})
}

/**
 * Everything `compositeArtwork` would read, as one string — so a caller holding
 * its result can tell when that result has stopped being true.
 *
 * Kept beside the composite it describes, because the two drifting apart is the
 * failure it exists to prevent: whatever the composite reads has to be in here,
 * and whatever it ignores must not be.
 *
 * Walked whole rather than flattened to the rasters. A folder carries its own
 * opacity and blend mode, and those reach the page without any layer inside it
 * having changed — flattening drops them, and the holder would go on trusting a
 * picture the page no longer matches.
 *
 * Text is left out because the composite leaves it out: typing a translation
 * must not throw away a sample that is still good.
 */
export function artworkSignature(nodes: readonly StackNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    const paint = `${node.opacity}|${node.blendMode}`
    if (node.kind === 'raster') {
      const { file, x, y, w, h } = node.entry
      parts.push(`r ${file}|${x},${y},${w},${h}|${paint}`)
    } else if (node.kind === 'buffer') {
      parts.push(`g ${node.entry.id}|${paint}(${artworkSignature(node.children)})`)
    }
  }
  return parts.join('\n')
}

async function compositeWith(
  input: CompositeInput,
  drawText: StackPaint['drawText'],
): Promise<OffscreenCanvas> {
  const size = { w: input.page.width, h: input.page.height }
  const stack = pageStack(input.page.layers)
  const rasters = await decodeLayerBitmaps(stack, input.loadLayer)
  try {
    const canvas = new OffscreenCanvas(size.w, size.h)
    drawStack(context2d(canvas), stack, { page: size, rasters, drawText })
    return canvas
  } finally {
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
