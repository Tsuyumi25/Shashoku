import { computed, ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { clamp, screenToContentPx, type Anchor, type ViewTransform } from '@/lib/coords'
import { clipPathOf } from '@/lib/explode/frames'
import { shiftedView, type Piece } from '@/lib/explode/pieces'
import {
  landingAt,
  partitionPage,
  regionAt,
  regionsTouching,
  type Landing,
  type Partition,
  type Rect,
} from '@/lib/explode/partition'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

export const MIN_CAP = 0
export const MAX_FACTOR = 1.5

/**
 * Where the gap starts. Uncut, the page has nothing to push apart, so the gap
 * can stand ready and the first cut already shows.
 */
export const DEFAULT_FACTOR = 0.5

/** No explosion: the whole page is one piece, and the view is the view. */
export const WHOLE_PAGE = -1

/**
 * The page in the canvas split along the gaps between what was read on it, and
 * the pieces pushed out from the middle — a way of looking at a crowded page,
 * and nothing the project holds. Nothing here is written to a file, and a
 * session starts with the page whole.
 */
export const useExplodeStore = defineStore('explode', () => {
  const editor = useEditorStore()
  const project = useProjectStore()

  /** The largest a merged region may grow, as a share of the page. 1 is the whole page in one piece. */
  const cap = ref(1)

  /** How far a region travels per page pixel between its anchor and the page's middle. */
  const factor = ref(DEFAULT_FACTOR)

  function setCap(share: number) {
    cap.value = clamp(share, MIN_CAP, 1)
  }

  function setFactor(share: number) {
    factor.value = clamp(share, 0, MAX_FACTOR)
  }

  const pageSize = computed(() => editor.viewContentSize)

  /**
   * The rectangles the cut is made along, held by value: a reading's text can
   * be corrected all day without moving the box it was read from, and the cut
   * costs tens of milliseconds.
   */
  let held: { key: string; rects: Rect[] } = { key: '', rects: [] }
  const boxes = computed<readonly Rect[]>(() => {
    const pageId = editor.currentPageId
    const rects = (pageId === null ? [] : project.readingsOfPage(pageId)).map((c) => ({
      x: Math.round(c.x),
      y: Math.round(c.y),
      w: Math.round(c.w),
      h: Math.round(c.h),
    }))
    const key = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(';')
    if (key !== held.key) held = { key, rects }
    return held.rects
  })

  /**
   * Nothing is cut until something asks to see it apart: a page that is whole
   * costs the partition nothing, which is what keeps the canvas as it was.
   */
  const partition = computed<Partition | null>(() => {
    const page = pageSize.value
    if (cap.value === 1 || factor.value === 0 || page.w === 0 || page.h === 0) return null
    return partitionPage(page, boxes.value, cap.value)
  })

  const regions = computed(() => partition.value?.regions ?? [])

  const exploded = computed(() => factor.value > 0 && regions.value.length > 1)

  /** Everything the pieces cover where they stand now, or null while the page is whole. */
  const shownArea = computed<Rect | null>(() => {
    if (!exploded.value) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    regions.value.forEach((region, at) => {
      const by = offsetOf(at)
      for (const run of region.runs) {
        x0 = Math.min(x0, run.x + by.x)
        y0 = Math.min(y0, run.y + by.y)
        x1 = Math.max(x1, run.x + run.w + by.x)
        y1 = Math.max(y1, run.y + run.h + by.y)
      }
    })
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })

  // Fitting the view frames the page as it is shown, pieces and gaps together.
  // Synchronous, so a fit asked for in the same breath as a change sees it.
  watchEffect(
    () => {
      editor.viewFitArea = shownArea.value
    },
    { flush: 'sync' },
  )

  /** Where a region stands once pushed, in page pixels. */
  function offsetOf(region: number): Anchor {
    const at = region < 0 ? undefined : regions.value[region]?.anchor
    if (!at || !exploded.value) return { x: 0, y: 0 }
    const page = pageSize.value
    return { x: (at.x - page.w / 2) * factor.value, y: (at.y - page.h / 2) * factor.value }
  }

  /**
   * The view a region's own gestures and overlays speak in: the canvas's, with
   * that region's travel folded into the translation. Everything on the page
   * then goes on being written in page pixels, as it was before the page was
   * ever cut.
   */
  function viewOf(region: number): ViewTransform {
    return shiftedView(editor.view, offsetOf(region))
  }

  const shapes = computed(() =>
    regions.value.map((region) => {
      const path = new Path2D()
      for (const run of region.runs) path.rect(run.x, run.y, run.w, run.h)
      return path
    }),
  )

  /** Each piece as a canvas painting under `view` draws it, or null while the page is whole. */
  function piecesOf(view: ViewTransform): Piece[] | null {
    if (!exploded.value) return null
    return shapes.value.map((shape, region) => ({ shape, view: shiftedView(view, offsetOf(region)) }))
  }

  /** Which region a point of the page itself belongs to, before anything was pushed. */
  function regionAtPage(p: Anchor): number {
    const cut = partition.value
    if (cut === null || !exploded.value) return WHOLE_PAGE
    return regionAt(cut, p.x, p.y)
  }

  /**
   * Which region a screen point is showing, or `null` for the gap between two
   * of them — where there is nothing to press on, as outside the page.
   *
   * Each region is asked in its own coordinates: a point belongs to the region
   * that, pushed where it is, has that point over one of its own cells.
   */
  function regionAtScreen(clientX: number, clientY: number, origin: { left: number; top: number }): number | null {
    const cut = partition.value
    if (cut === null || !exploded.value) return WHOLE_PAGE
    for (let r = 0; r < cut.regions.length; r++) {
      const p = pageAtScreen(clientX, clientY, origin, r)
      if (regionAt(cut, p.x, p.y) === r) return r
    }
    return null
  }

  /** Where a screen point lands on the page, read through one region's own window. */
  function pageAtScreen(
    clientX: number,
    clientY: number,
    origin: { left: number; top: number },
    region: number,
  ): Anchor {
    return screenToContentPx(clientX, clientY, origin, viewOf(region))
  }

  /**
   * Which pieces a rectangle of the page is drawn on, the one holding its
   * middle first — a frame that crosses a boundary is drawn once per piece.
   */
  function regionsOfBox(box: Rect): number[] {
    const cut = partition.value
    if (cut === null || !exploded.value) return [WHOLE_PAGE]
    const touched = regionsTouching(cut, box)
    return touched.length === 0 ? [WHOLE_PAGE] : touched
  }

  /** Each piece's shape as a CSS `clip-path`, in page pixels. */
  const clips = computed(() => regions.value.map((region) => clipPathOf(region.runs)))

  function clipOf(region: number): string | undefined {
    return region < 0 ? undefined : clips.value[region]
  }

  /**
   * Where a point of the page as it is shown lands on the page itself: the
   * explosion undone, and the gaps — which the page has no width for — closed
   * onto the nearest piece. See `landingAt`.
   */
  function landingAtShown(shown: Anchor): Landing {
    const cut = partition.value
    if (cut === null || !exploded.value) return { region: WHOLE_PAGE, point: shown }
    return landingAt(cut, shown, offsetOf)
  }

  return {
    cap,
    factor,
    setCap,
    setFactor,
    partition,
    regions,
    exploded,
    shownArea,
    offsetOf,
    viewOf,
    piecesOf,
    regionAtPage,
    regionAtScreen,
    pageAtScreen,
    regionsOfBox,
    clipOf,
    landingAtShown,
  }
})
