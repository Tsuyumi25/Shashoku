<template>
  <span class="thumb relative block shrink-0 overflow-hidden rounded-xs" :style="boxStyle">
    <canvas ref="canvasEl" class="absolute inset-0 h-full w-full" />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'

/**
 * One raster layer's own picture, at the size of a row.
 *
 * Drawn to the layer's frame rather than to the page. A thumbnail is here to
 * tell one row from another, and with one erase patch per region a
 * page-relative one gives twenty rows of near-identical specks.
 *
 * That costs nothing to arrange: a layer's PNG already covers its frame and no
 * more, so the file *is* the thumbnail and there is no compositing to do and
 * nothing worth precomputing into the page cache beside it.
 *
 * Only rasters get one. A folder and a text object both carry a name that says
 * which row they are — pixels are the content that reads as nothing, which is
 * the whole of the argument for showing them.
 */
const props = defineProps<{
  entry: RasterLayerEntry
  /** Where this page's layer files live. */
  layersDir: string
}>()

/** Sized to the row it sits in, which is 28px tall. */
const EDGE = 20

const boxStyle = { width: `${EDGE}px`, height: `${EDGE}px` }

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
const dpr = window.devicePixelRatio || 1

let held: ImageBitmap | null = null
let token = 0

function release() {
  held?.close()
  held = null
}

function paint() {
  const cv = canvasEl.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const edge = Math.max(1, Math.round(EDGE * dpr))
  if (cv.width !== edge || cv.height !== edge) {
    cv.width = edge
    cv.height = edge
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, edge, edge)
  if (held === null) return

  // Letterboxed, so a wide patch is not stretched into a square and every row
  // reads at the shape it really is.
  const scale = Math.min(edge / held.width, edge / held.height)
  const w = Math.max(1, Math.round(held.width * scale))
  const h = Math.max(1, Math.round(held.height * scale))
  ctx.imageSmoothingEnabled = true
  // Most patches are flat white on transparent, so what survives the reduction
  // is the shape — which is the one thing this is here to show.
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(held, Math.round((edge - w) / 2), Math.round((edge - h) / 2), w, h)
}

async function load() {
  const mine = ++token
  release()
  paint()
  const { file, w, h } = props.entry
  // A layer nothing has been written to yet has no frame, and so no file.
  if (w === 0 || h === 0) return
  try {
    const bytes = await window.api.readImage(props.layersDir, file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    if (mine !== token) {
      bitmap.close()
      return
    }
    held = bitmap
    paint()
  } catch (err) {
    // A row without its picture still says which layer it is by name; the
    // manifest naming a file the disk does not have is the export's to refuse.
    console.error('layer thumbnail unavailable', file, err)
  }
}

watch(
  () => [props.layersDir, props.entry.file, props.entry.w, props.entry.h] as const,
  load,
  { immediate: true },
)

onBeforeUnmount(release)
</script>

<style scoped>
/*
 * A checker under the picture, because most erase patches are flat white on
 * transparent — on a light theme one would otherwise be an empty box.
 */
.thumb {
  background-image:
    linear-gradient(45deg, var(--muted) 25%, transparent 25%),
    linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--muted) 75%),
    linear-gradient(-45deg, transparent 75%, var(--muted) 75%);
  background-size: 8px 8px;
  background-position:
    0 0,
    0 4px,
    4px -4px,
    -4px 0;
  outline: 1px solid var(--border);
  outline-offset: -1px;
}
</style>
