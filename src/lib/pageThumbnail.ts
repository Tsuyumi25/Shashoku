import type { ProjectFile } from '@/types/project'
import { serializeLayers } from '@shared/page/schema'
import { layersDirOf } from '@shared/ssk/constants'
import { compositePage, fitWithin, resizeCanvas } from '@/lib/pageComposite'

/** Longest edge of a cached thumbnail. */
export const THUMBNAIL_EDGE = 320

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Names everything that went into drawing the page, so a re-typeset one cannot
 * come back showing what it used to look like. A layer file is written once by
 * whatever made it and never rewritten, so naming the file is enough to stand
 * for its pixels; what moves is which layers there are and where they sit.
 *
 * The page's own size is in here because it is what the picture is drawn on:
 * the layers could all be untouched and the page still come out a different
 * shape. Nothing else from the project document is, because nothing else in it
 * reaches the page — each object carries its whole style, so the serialized
 * tree already names every pixel decision. That also ends an old annoyance:
 * a nudge to a delivery setting used to throw away every thumbnail in the
 * chapter, back when the key hashed the document to catch the styles inside it.
 */
export function thumbnailKey(file: ProjectFile, edge: number = THUMBNAIL_EDGE): Promise<string> {
  return digest(
    // JSON rather than a joined string: one of these parts is itself a
    // serialized document full of whatever separator would be picked, and a
    // key two different sets of inputs could produce is a thumbnail shown for
    // the wrong page.
    JSON.stringify([
      'page',
      edge,
      file.pageDir,
      file.page.width,
      file.page.height,
      // The tree alone. Reading order is left out on purpose: it decides which
      // object comes first in the label list, never what the page looks like,
      // and hashing it would throw the picture away for a reordering.
      serializeLayers(file.page.layers),
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
 * A project's cover is one layer file, not a composited page: the library knows
 * a project's path and where its first page keeps its bottom raster, and
 * compositing would mean opening every project in the sidebar to read its
 * labels. A cover says which project this is, which the bottom of page one does.
 *
 * Its path is enough to key it. A layer file is written once by whatever made
 * it and never rewritten — an edit produces a new file — so the pixels behind a
 * path cannot change under the cache.
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
  bytes: Uint8Array,
  edge: number = THUMBNAIL_EDGE,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
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
  file: ProjectFile,
  edge: number = THUMBNAIL_EDGE,
): Promise<Uint8Array> {
  const full = await compositePage({
    page: file.page,
    loadLayer: (name) => window.api.readImage(layersDirOf(file.pageDir), name),
  })
  const size = fitWithin({ w: full.width, h: full.height }, edge)
  return encodePng(resizeCanvas(full, size.w, size.h))
}
