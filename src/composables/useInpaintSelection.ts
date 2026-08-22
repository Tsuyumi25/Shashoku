import { computed, ref } from 'vue'
import { layersDirOf } from '@shared/ssk/constants'
import { useRasterTarget } from '@/composables/useRasterTarget'
import { compositeLayerAlone, context2d, encodePng } from '@/lib/pageComposite'
import { isEmptyRect, type Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'

/**
 * How much of the surrounding picture goes along with the hole.
 *
 * The model is shown a region rather than the page: it answers with everything
 * it is given, and a manga page put through whole comes back drifting
 * everywhere at once. What it does need is somewhere to read the pattern it is
 * meant to continue from — a balloon cut out at its own edge gives the network
 * nothing but the hole.
 *
 * A flat margin, which is IOPaint's and koharu's answer. Krita scales it with
 * the picture; nobody surveyed writes down why either is right, so the simpler
 * one is here until something measured says otherwise.
 */
const CONTEXT_MARGIN = 128

/**
 * Erasing a selection by asking the retoucher to redraw what was under it.
 *
 * The same shape as filling, with the colour arriving from a model instead of
 * from the swatch: one scratch, one transaction, one swappable record. That is
 * deliberate — an erase that could not be taken back the same way as every
 * other write would be the one operation in the editor with its own history.
 *
 * Writes into the layer being worked on, which is where every other exit from a
 * selection writes. The shape this eventually wants is Photoshop's — a layer of
 * its own, with the mask and its feathering living on that layer — but layers
 * have no masks yet, and putting the pixels somewhere they cannot be masked
 * would be a different feature wearing this one's name.
 */
export function useInpaintSelection() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const selection = useSelectionStore()
  const notices = useNoticeStore()
  const preferences = usePreferencesStore()
  const raster = useRasterStore()
  const { target, refuse } = useRasterTarget()

  /** True while the model has the region, so nothing asks for a second one. */
  const working = ref(false)

  const canErase = computed(
    () =>
      !working.value &&
      editor.currentPageId !== null &&
      target.value !== null &&
      selection.bounds !== null &&
      !isEmptyRect(selection.bounds),
  )

  /** The selection's box with room round it, kept inside the page. */
  function contextRegion(bounds: Rect, page: { width: number; height: number }): Rect {
    const x = Math.max(0, bounds.x - CONTEXT_MARGIN)
    const y = Math.max(0, bounds.y - CONTEXT_MARGIN)
    return {
      x,
      y,
      w: Math.min(page.width, bounds.x + bounds.w + CONTEXT_MARGIN) - x,
      h: Math.min(page.height, bounds.y + bounds.h + CONTEXT_MARGIN) - y,
    }
  }

  /**
   * Coverage as a picture the model can open: grey where the mask is, opaque
   * throughout. Anything above zero counts as a hole on the far side, so this
   * is a shape rather than a weighting — what a feathered rim means is settled
   * when the answer is written back, by the same mask.
   */
  async function maskPng(coverage: Uint8ClampedArray, region: Rect): Promise<Uint8Array> {
    const image = new ImageData(region.w, region.h)
    for (let i = 0; i < coverage.length; i += 1) {
      const at = i * 4
      image.data[at] = coverage[i]
      image.data[at + 1] = coverage[i]
      image.data[at + 2] = coverage[i]
      image.data[at + 3] = 255
    }
    const canvas = new OffscreenCanvas(region.w, region.h)
    context2d(canvas).putImageData(image, 0, 0)
    return await encodePng(canvas)
  }

  async function eraseByModel(): Promise<void> {
    const page = editor.currentPageId
    if (page === null || working.value) return
    const file = project.pageById(page)
    if (!file) return

    const bounds = selection.bounds
    if (bounds === null || isEmptyRect(bounds)) {
      notices.say('沒有選區可以修補')
      return
    }
    const entry = target.value
    if (entry === null) {
      notices.say('選一個點陣圖層再修補')
      return
    }
    if (refuse(page, entry)) return

    const region = contextRegion(bounds, file.page)
    const wide = selection.maskPatchOf(page, region)
    const tight = selection.maskPatchOf(page, bounds)
    if (wide === null || tight === null) return

    working.value = true
    try {
      const layersDir = layersDirOf(file.pageDir)
      const whole = await compositeLayerAlone({
        entry,
        page: { w: file.page.width, h: file.page.height },
        loadLayer: (name) => window.api.readImage(layersDir, name),
        live: raster.liveLayer(entry.id),
      })

      const cut = new OffscreenCanvas(region.w, region.h)
      context2d(cut).drawImage(whole, -region.x, -region.y)
      const answer = await window.inpaint.erase({
        image: await encodePng(cut),
        mask: await maskPng(wide, region),
      })

      // Only the selection's own box comes back out of the answer. The rest of
      // it is the context, redrawn as faithfully as the model could manage and
      // still not the pixels that were there.
      const redrawn = await createImageBitmap(new Blob([answer.image as BlobPart]))
      const patch = new OffscreenCanvas(bounds.w, bounds.h)
      const patchCtx = context2d(patch)
      try {
        patchCtx.drawImage(redrawn, region.x - bounds.x, region.y - bounds.y)
      } finally {
        redrawn.close()
      }
      const rgba = patchCtx.getImageData(0, 0, bounds.w, bounds.h).data

      await write(entry, page, file.pageDir, layersDir, bounds, tight, rgba)
    } catch (problem) {
      notices.say(`修補失敗:${problem instanceof Error ? problem.message : String(problem)}`)
    } finally {
      working.value = false
    }
  }

  /**
   * The model's pixels into the layer, as one step.
   *
   * Identical to what a fill does past this point, because past this point it
   * is a fill: a mask, a rectangle, and bytes to lay down through it.
   */
  async function write(
    entry: NonNullable<typeof target.value>,
    page: string,
    pageDir: string,
    layersDir: string,
    bounds: Rect,
    mask: Uint8ClampedArray,
    rgba: Uint8ClampedArray,
  ): Promise<void> {
    await raster.take(entry, page, layersDir, pageDir)
    editor.forgetJournals(
      window.engine.rasterTrimHistory(
        preferences.prefs.undoPixelSteps,
        preferences.prefs.undoPixelBytes,
      ),
    )

    const patch = window.engine.rasterPaste(
      entry.id,
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      new Uint8Array(mask),
      { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      entry.alphaLocked,
    )
    if (patch === null) return
    raster.paste(entry.id, patch)
    await raster.owe(entry.id)

    const swap = () => {
      const back = window.engine.rasterApplyJournal(patch.journal)
      if (back !== null) raster.paste(entry.id, back)
      void raster.owe(entry.id)
    }
    editor.pushCommand(
      {
        label: `inpaint-selection ${entry.id}`,
        journal: patch.journal,
        do: swap,
        undo: swap,
        forget: () => window.engine.rasterDropJournal(patch.journal),
      },
      { alreadyApplied: true },
    )
  }

  return { canErase, working, eraseByModel }
}
