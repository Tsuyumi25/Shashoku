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
 * cannot outlive the pixels it was decoded from. Turning the page drops the lot
 * once the next page's are in: a decoded layer costs its frame in bytes, and
 * holding a chapter's worth would be the full-page-buffer bill the layer frame
 * exists to avoid — two pages for the length of a decode is the most it holds.
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
  /**
   * Pixels that came from somewhere other than a read, filed as though they had.
   *
   * A gesture that resamples a layer holds the result and mints a name for it,
   * and the entry starts pointing at that name in the same breath. Waiting on a
   * read of the file just written would leave a hole in the page for as long as
   * the disk takes — so what was written is handed over instead.
   *
   * The folder comes too: a page turned while the write was out has already let
   * everything go, and pixels belonging to a page nobody is looking at are not
   * kept.
   */
  adopt(layersDir: string, file: string, bitmap: ImageBitmap): void
  /** Counts up as each read lands, which is what asks the canvas to draw again. */
  revision: Readonly<Ref<number>>
  /**
   * The folder whose layers are held. Lags the folder asked for across a page
   * turn: the old page's pixels stay until every layer of the new one is
   * decoded, and then all of them change hands at once.
   */
  heldDir: Readonly<Ref<string | null>>
}

export function useLayerBitmaps(
  layersDir: () => string | null,
  /** Every layer file the page draws, so nothing off the page is ever decoded. */
  wanted: () => readonly string[],
): LayerBitmaps {
  let held = new Map<string, ImageBitmap>()
  const revision = ref(0)
  /** Which page's files are in there, so a page turn cannot leave one behind. */
  const heldDir = ref<string | null>(null)
  let token = 0

  function releaseAll(): void {
    for (const bitmap of held.values()) bitmap.close()
    held.clear()
  }

  /**
   * Every read at once rather than one after another: the disk and the decoder
   * both overlap, so a page of a base map and a few patches costs the slowest of
   * them instead of the sum.
   */
  async function decodeAll(dir: string, files: readonly string[]): Promise<Map<string, ImageBitmap>> {
    const out = new Map<string, ImageBitmap>()
    await Promise.all(
      files.map(async (file) => {
        try {
          const bytes = await window.api.readImage(dir, file)
          out.set(file, await createImageBitmap(new Blob([bytes as BlobPart])))
        } catch (err) {
          // The page is still worth looking at without one patch, and the
          // manifest is what says the patch should be there — this is not where
          // that is reported. Export refuses outright, which is where it matters.
          console.error('layer image unavailable', file, err)
        }
      }),
    )
    return out
  }

  /**
   * A page turn swaps the whole set in one step once the new page is decoded,
   * so the canvas never shows the new page's text over nothing, then its base
   * map, then its patches — three pictures where there should be one. Within a
   * page, a layer arriving later (a new patch, a resample) joins as it lands.
   */
  async function load(): Promise<void> {
    const mine = ++token
    const dir = layersDir()
    const files = [...new Set(wanted())]
    if (dir !== heldDir.value) {
      const next = dir === null ? new Map<string, ImageBitmap>() : await decodeAll(dir, files)
      // Turned again while this was out: nothing on screen is asking for it.
      if (mine !== token) {
        for (const bitmap of next.values()) bitmap.close()
        return
      }
      releaseAll()
      held = next
      heldDir.value = dir
      revision.value += 1
      return
    }
    const keep = new Set(files)
    for (const [file, bitmap] of held) {
      if (keep.has(file)) continue
      bitmap.close()
      held.delete(file)
    }
    if (dir === null) return
    const missing = files.filter((file) => !held.has(file))
    if (missing.length === 0) return
    const arrived = await decodeAll(dir, missing)
    if (mine !== token || heldDir.value !== dir) {
      for (const bitmap of arrived.values()) bitmap.close()
      return
    }
    for (const [file, bitmap] of arrived) {
      held.get(file)?.close()
      held.set(file, bitmap)
    }
    revision.value += 1
  }

  function adopt(dir: string, file: string, bitmap: ImageBitmap): void {
    if (dir !== heldDir.value) return bitmap.close()
    held.get(file)?.close()
    held.set(file, bitmap)
    revision.value += 1
  }

  watch(
    () => [layersDir(), [...wanted()].join(' ')] as const,
    () => {
      void load()
    },
    { immediate: true },
  )

  onScopeDispose(releaseAll)

  return { get: (file) => held.get(file), adopt, revision, heldDir }
}
