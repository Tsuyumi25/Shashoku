import type { ProjectJson } from '@shared/project/types'
import type { ProjectFile } from '@/types/project'
import { serializeTextStyle } from '@shared/text-style/schema'
import { serializeLayers } from '@shared/page/schema'
import { compositePage, fitWithin, resizeCanvas } from '@/lib/pageComposite'

/** Longest edge of a cached thumbnail. */
export const THUMBNAIL_EDGE = 320

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The part of a project that reaches the page: the styles a label resolves
 * through, which is `defaultStyle` and what each group lays over it. Identity
 * comes along because that is what a label names its group by.
 *
 * Everything else in the document is left out on purpose. A group's name and
 * colour belong to the sidebar, and the export profiles decide what a
 * delivered file is, not what the page looks like — hashing the document whole
 * made a nudge to a delivery setting throw away every thumbnail in the chapter.
 */
function drawingStyles(meta: ProjectJson): unknown {
  return [
    serializeTextStyle(meta.defaultStyle),
    meta.groups.map((g) => [g.id, serializeTextStyle(g.style)]),
  ]
}

/**
 * Names everything that went into drawing the page, so a re-typeset one cannot
 * come back showing what it used to look like. The raws copy is written once
 * and never again, so the page's identity is enough to stand for its pixels;
 * the labels and the styles they resolve through are what actually move.
 */
export function thumbnailKey(
  file: ProjectFile,
  meta: ProjectJson,
  edge: number = THUMBNAIL_EDGE,
): Promise<string> {
  return digest(
    // JSON rather than a joined string: one of these parts is itself a
    // serialized document full of whatever separator would be picked, and a
    // key two different sets of inputs could produce is a thumbnail shown for
    // the wrong page.
    JSON.stringify([
      'page',
      edge,
      file.pageDir,
      // The tree alone. Reading order is left out on purpose: it decides which
      // object comes first in the label list, never what the page looks like,
      // and hashing it would throw the picture away for a reordering.
      serializeLayers(file.page.layers),
      drawingStyles(meta),
    ]),
  )
}

/**
 * Compositing a page decodes a full-resolution image and draws every label on
 * it. A grid scrolled quickly would otherwise ask for two dozen of those at
 * once and take the interface down with it, so they queue.
 */
const MAX_PARALLEL = 3
let running = 0
const waiting: Array<() => void> = []

export async function inRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

async function encodePng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * A project's cover is a raw page, not a composited one: the library knows a
 * project's path and its first filename and nothing else, and compositing one
 * would mean opening every project in the sidebar to read its labels. A cover
 * says which project this is, which the raw does.
 *
 * Its identity is enough to key it. A raws copy is written once and never
 * touched again, so the pixels behind a path cannot change under the cache.
 */
export function coverKey(
  projectPath: string,
  cover: string,
  edge: number = THUMBNAIL_EDGE,
): Promise<string> {
  return digest(JSON.stringify(['cover', edge, projectPath, cover]))
}

/**
 * Reduced through a canvas rather than by handing a full-size image to the
 * layout. Scaling an <img> down goes through Chromium's mipmap path, which at
 * the ratio a page reaches in a sidebar keeps the odd hard edge while losing
 * most of what was around it — detail standing out of a picture that is
 * otherwise mush. Owning the downsample means owning imageSmoothingQuality,
 * which is also what the page grid does, so the two stop looking like
 * different renderers.
 */
export async function renderCover(
  raw: Uint8Array,
  edge: number = THUMBNAIL_EDGE,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([raw as BlobPart]))
  try {
    const size = fitWithin({ w: bitmap.width, h: bitmap.height }, edge)
    const canvas = new OffscreenCanvas(size.w, size.h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, size.w, size.h)
    return encodePng(canvas)
  } finally {
    bitmap.close()
  }
}

/**
 * The page as it will be delivered, small. Drawn at full size and then reduced
 * in one step, because a thumbnail is here to answer "did page 47 get typeset"
 * and a shortcut that changed where the text landed would answer a different
 * question.
 */
export async function renderThumbnail(
  raw: Uint8Array,
  file: ProjectFile,
  meta: ProjectJson,
  edge: number = THUMBNAIL_EDGE,
): Promise<Uint8Array> {
  const full = await compositePage({
    raw,
    page: file.page,
    groups: meta.groups,
    defaultStyle: meta.defaultStyle,
  })
  const size = fitWithin({ w: full.width, h: full.height }, edge)
  return encodePng(resizeCanvas(full, size.w, size.h))
}
