import type { ManifestJson, RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import type { LayerEffect } from '@shared/effects/types'
import { joinedBelow, strokeOf } from '@shared/effects/stroke'
import {
  pageStack,
  stackedTextNodes,
  type RasterStackNode,
  type StackNode,
  type TextStackNode,
} from '@shared/page/stack'
import { shownCodeOf } from '@shared/page/units'
import { faceTree } from '@shared/page/trees'
import { smoothingQualityFor } from '@/lib/coords'
import { drawnLabel } from '@/lib/labelRaster'
import { lettersOnly, withJoinedBands } from '@/lib/joinedStroke'
import { layerWithEffects, pictureWithEffects } from '@/lib/layerEffects'
import { applyPlacement, type LayerPlacement } from '@/lib/layerTransform'
import type { StrokeOverlay } from '@/stores/strokeOverlayStore'
import { sampleSource } from '@/lib/fontSampleCache'

/**
 * A page that cannot be drawn faithfully. Never swallowed: the whole point of
 * looking at composited pages before an export is to find out that page 47 is
 * wrong, and a page quietly missing its text would say the opposite.
 */
export class CompositeError extends Error {}

export interface CompositeInput {
  page: ManifestJson
  /** Which face's lettering goes on the page. */
  face: string
  /**
   * One raster layer's PNG, by the file name the manifest holds. A loader
   * rather than a bag of bytes so that the caller only has to say where layers
   * live, and this decides which of them the page actually needs.
   */
  loadLayer(file: string): Promise<Uint8Array>
  /**
   * A layer's pixels as they stand in memory, for layers being edited.
   *
   * Only on-screen consumers pass this. Pixels reach disk on a scheduler of
   * their own, so a layer under the hand is ahead of its file for tens of
   * seconds at a time — and the wand reading the page as it was tens of seconds
   * ago would be reading a different page.
   *
   * Deliberately not passed by anything that delivers. Export and thumbnails
   * settle the pixels first and then read the folder, which keeps what is
   * delivered and what is on disk the same thing by construction.
   */
  liveLayer?(id: string): { canvas: OffscreenCanvas; frame: Frame } | null
}

interface Size {
  w: number
  h: number
}

/** A rectangle on the page, which is what a raster layer occupies. */
interface Frame extends Size {
  x: number
  y: number
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

function drawTextWith(stack: readonly StackNode[]): StackPaint['drawText'] {
  const labelOf = (entry: TextLayerEntry, effects: readonly LayerEffect[]) =>
    drawnLabel(shownCodeOf(entry), entry.body.style, effects, { x: entry.body.x, y: entry.body.y }, entry.body.rotation)
  const joined = joinedBelow(
    stackedTextNodes(stack).map((node) => node.entry),
    (entry) => entry.effects,
  )
  return (ctx, node) => {
    const label = node.entry
    if (shownCodeOf(label).length === 0) return
    const drawn = labelOf(label, label.effects)
    // A family this machine lacks draws notdef boxes rather than nothing, so the
    // only way to arrive here without a bitmap is a catalogue that never
    // answered. Exporting the page short one label silently would be worse than
    // stopping, since the file would look finished.
    if (!drawn.sample) throw new CompositeError(`字型目錄尚未就緒，無法匯出標籤「${drawn.plain}」`)

    const under = joined.get(label.id)
    const position = strokeOf(label.effects)?.position
    const picture =
      (under &&
        position &&
        withJoinedBands(
          drawn,
          labelOf(label, lettersOnly(label.effects)),
          position,
          under.map((entry) => labelOf(entry, entry.effects)),
        )) ??
      sampleSource(drawn.sample)

    // The engine already turned the outline, so there is nothing left to rotate
    // here and nothing to resample: the bitmap lands one pixel per pixel.
    const { width, height } = drawn.sample.image
    ctx.translate(drawn.center.x, drawn.center.y)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = smoothingQualityFor(1)
    ctx.drawImage(picture, -width / 2, -height / 2)
  }
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
  rasters: { get(file: string): ImageBitmap | undefined }
  /** A layer's live pixels, when the caller has any. See `CompositeInput`. */
  liveLayer?(id: string): { canvas: OffscreenCanvas; frame: Frame } | null
  /** Where a gesture in progress has taken a layer, which only the canvas has. */
  place?(id: string): LayerPlacement | undefined
  /** The stroke being drawn on a layer, which only the canvas has. */
  overlay?(id: string): StrokeOverlay | null
  /** How a text object is drawn. Merge never has one and refuses instead. */
  drawText(ctx: OffscreenCanvasRenderingContext2D, node: TextStackNode): void
}

/**
 * One raster with its effects, where a gesture has taken it, and with the
 * stroke being drawn on it.
 *
 * A layer under a stroke is drawn on a canvas of its own first: an eraser takes
 * alpha out of whatever it lands on, and landing on the shared one would punch
 * through the neighbours too.
 */
function drawRaster(
  ctx: OffscreenCanvasRenderingContext2D,
  node: RasterStackNode,
  paint: StackPaint,
): void {
  // The live pixels win where there are any, and they carry their own frame:
  // a write that grew the layer moved it, and the manifest is not told until
  // the file naming the new frame is on disk.
  const live = paint.liveLayer?.(node.entry.id) ?? null
  const source = live?.canvas ?? paint.rasters.get(node.entry.file)
  const overlay = paint.overlay?.(node.entry.id) ?? null
  const target = overlay === null ? ctx : context2d(new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height))
  if (target !== ctx) target.setTransform(ctx.getTransform())

  const frame = live?.frame ?? node.entry
  if (source && frame.w > 0 && frame.h > 0) {
    const { x, y, w, h } = frame
    // A band reaches past the layer, so what gets drawn is the bigger picture at
    // the bigger rectangle — clipping it back to the layer's own frame is
    // exactly the edge the margin exists to hold.
    const effected = layerWithEffects(source, { x, y, w, h }, node.entry.effects)
    const place = paint.place?.(node.entry.id)
    if (place) {
      target.save()
      applyPlacement(target, node.entry, place, { x: 0, y: 0 })
      const offset = effected ? effected.frame.x - x : 0
      target.drawImage(effected?.canvas ?? source, offset, offset, effected?.frame.w ?? w, effected?.frame.h ?? h)
      target.restore()
    } else if (effected) {
      target.drawImage(effected.canvas, effected.frame.x, effected.frame.y)
    } else {
      target.drawImage(source, x, y, w, h)
    }
  }

  if (overlay === null) return
  const { canvas, region, op } = overlay
  target.globalCompositeOperation = op
  target.drawImage(canvas, region.x, region.y, region.w, region.h)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(target.canvas, 0, 0)
  ctx.restore()
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
      drawRaster(ctx, node, paint)
    } else if (node.kind === 'text') {
      paint.drawText(ctx, node)
    } else {
      // A folder with blending of its own has to become one picture before that
      // blending can apply, which is the buffer the pass-through default avoids.
      // Its effects are grown from that picture too, so members that touch
      // share one outline rather than each drawing theirs across the other.
      //
      // Always page-sized and drawn in page coordinates, so whatever offset this
      // context carries is applied once — when the finished buffer lands — and
      // never again inside it.
      const buffer = new OffscreenCanvas(paint.page.w, paint.page.h)
      drawStack(context2d(buffer), node.children, paint)
      const effected = pictureWithEffects(buffer, node.entry.effects)
      if (effected) ctx.drawImage(effected.canvas, effected.frame.x, effected.frame.y)
      else ctx.drawImage(buffer, 0, 0)
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
  return await compositeWith(input, () => () => {})
}

/**
 * One raster layer on a page-sized canvas, at the rectangle it occupies.
 *
 * What the wand reads and what the retoucher is shown, which is why it is one
 * function: those two have to agree about what "this layer" means down to the
 * pixel, or a selection would be traced on one picture and acted on in another.
 *
 * The engine's pixels win wherever it holds the layer, and they bring their own
 * frame — a write that grew the layer moved it, and the manifest is not told
 * until the file naming the new frame is on disk. Falling back to the entry's
 * frame in that window would draw the layer where it used to be.
 */
export async function compositeLayerAlone(input: {
  entry: RasterLayerEntry
  page: Size
  loadLayer(file: string): Promise<Uint8Array>
  /** The layer's live pixels, when the engine is holding it. See `CompositeInput`. */
  live: { canvas: OffscreenCanvas; frame: Frame } | null
}): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(input.page.w, input.page.h)
  const ctx = context2d(canvas)
  if (input.live !== null) {
    ctx.drawImage(input.live.canvas, input.live.frame.x, input.live.frame.y)
    return canvas
  }
  // A layer with no frame has no file worth reading, and an empty page-sized
  // canvas is the truthful picture of it: transparent everywhere.
  const { x, y, w, h, file } = input.entry
  if (w <= 0 || h <= 0) return canvas
  const bitmap = await createImageBitmap(new Blob([(await input.loadLayer(file)) as BlobPart]))
  try {
    ctx.drawImage(bitmap, x, y, w, h)
  } finally {
    bitmap.close()
  }
  return canvas
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
export function artworkSignature(
  nodes: readonly StackNode[],
  /**
   * A token for a layer whose live pixels the composite would read instead of
   * its file, or null for one it would not. Without this the signature would
   * describe only the manifest, and a layer being painted on changes the
   * picture without the manifest hearing about it for tens of seconds.
   */
  liveAt?: (id: string) => string | null,
): string {
  const parts: string[] = []
  for (const node of nodes) {
    // Effects are in here for the same reason opacity is: they move pixels the
    // wand reads without any layer's own pixels having changed.
    const paint = `${node.opacity}|${node.blendMode}|${JSON.stringify(node.entry.effects)}`
    if (node.kind === 'raster') {
      const { file, x, y, w, h } = node.entry
      const live = liveAt?.(node.entry.id) ?? null
      parts.push(`r ${live === null ? `${file}|${x},${y},${w},${h}` : `live ${live}`}|${paint}`)
    } else if (node.kind === 'buffer') {
      parts.push(`g ${node.entry.id}|${paint}(${artworkSignature(node.children, liveAt)})`)
    }
  }
  return parts.join('\n')
}

async function compositeWith(
  input: CompositeInput,
  drawTextFor: (stack: readonly StackNode[]) => StackPaint['drawText'],
): Promise<OffscreenCanvas> {
  const size = { w: input.page.width, h: input.page.height }
  const stack = pageStack(faceTree(input.page, input.face), 'translation', input.face)
  const rasters = await decodeLayerBitmaps(stack, input.loadLayer)
  try {
    const canvas = new OffscreenCanvas(size.w, size.h)
    drawStack(context2d(canvas), stack, {
      page: size,
      rasters,
      liveLayer: input.liveLayer,
      drawText: drawTextFor(stack),
    })
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
