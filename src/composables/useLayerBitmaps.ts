import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * The decoded pixels of every layer the page draws, for as long as the page is
 * the one on screen.
 *
 * Held above the canvas rather than by whoever draws with them, because the
 * canvas re-cuts the stack into elements whenever a layer has to be held aside,
 * and elements owning their own decodes would each start empty and read their
 * layers back — a blink of nothing while the same files come round again. A cut
 * is a rearrangement of one page, and this is what says so.
 *
 * Keyed on the file name, which every write to a layer mints anew, so a bitmap
 * cannot outlive the pixels it was decoded from. Turning the page drops the lot:
 * a decoded layer costs its frame in bytes, and holding a chapter's worth would
 * be the full-page-buffer bill the layer frame exists to avoid.
 *
 * The alpha planes the hit test reads come from these same files, decoded a
 * second time. Kept apart for now — one wants the bitmap the compositor draws,
 * the other a byte per pixel to index — but deliberately shaped alike and stood
 * side by side, so whichever of them grows a decode worth sharing has somewhere
 * to put it.
 */
export interface LayerBitmaps {
  /** Undefined until the read lands; until then the layer is simply not drawn. */
  get(file: string): ImageBitmap | undefined
  /** Counts up as each read lands, which is what asks the canvas to draw again. */
  revision: Readonly<Ref<number>>
}

export function useLayerBitmaps(
  layersDir: () => string | null,
  /** Every layer file the page draws, so nothing off the page is ever decoded. */
  wanted: () => readonly string[],
): LayerBitmaps {
  const held = new Map<string, ImageBitmap>()
  const revision = ref(0)
  /** Which page's files are in there, so a page turn cannot leave one behind. */
  let heldDir: string | null = null
  let token = 0

  function releaseAll(): void {
    for (const bitmap of held.values()) bitmap.close()
    held.clear()
  }

  async function load(): Promise<void> {
    const mine = ++token
    const dir = layersDir()
    if (dir !== heldDir) {
      releaseAll()
      heldDir = dir
    }
    const files = new Set(wanted())
    for (const [file, bitmap] of held) {
      if (files.has(file)) continue
      bitmap.close()
      held.delete(file)
    }
    if (dir === null) return
    for (const file of files) {
      if (held.has(file)) continue
      try {
        const bytes = await window.api.readImage(dir, file)
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
        // The page turned while this was out: nothing on screen is asking for
        // it, and whatever it would have joined has already been let go.
        if (mine !== token) return bitmap.close()
        held.set(file, bitmap)
        revision.value += 1
      } catch (err) {
        // The page is still worth looking at without one patch, and the manifest
        // is what says the patch should be there — this is not where that is
        // reported. Export refuses outright, which is where it matters.
        console.error('layer image unavailable', file, err)
      }
    }
  }

  watch(
    () => [layersDir(), [...wanted()].join(' ')] as const,
    () => {
      void load()
    },
    { immediate: true },
  )

  onScopeDispose(releaseAll)

  return { get: (file) => held.get(file), revision }
}
