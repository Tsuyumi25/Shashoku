import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createPinia, setActivePinia } from 'pinia'
import { computed, ref, watch } from 'vue'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import type { EngineLayerPixels } from '@shared/engine/types'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { useLayerBrush } from '@/composables/useLayerBrush'
import { rasterizeRect } from '@/lib/selection/raster'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useStrokeOverlayStore } from '@/stores/strokeOverlayStore'

/**
 * The real engine, not a stand-in. What a stroke is for is the pixels it leaves
 * in the tiles, and the frame those pixels move — both of which only the addon
 * can answer.
 */
const engine = createRequire(import.meta.url)('@shashoku/engine') as Window['engine']

const PAGE_ID = 'source-260809-1200'
const PAGE = { page: PAGE_ID, w: 400, h: 300 }

/**
 * Enough of a canvas for the renderer's own mirror of a layer to exist, and for
 * the stroke's overlay to be read back.
 *
 * The layer's own pixels are never asserted on here — the engine holds those.
 * What is recorded is what the renderer *put* where, which for the overlay is
 * the only account of it there is: the picture a hand sees while it draws lives
 * on a canvas and nowhere else until the release.
 */
class FakeCanvas {
  puts: { image: FakeImageData; x: number; y: number }[] = []
  draws: { source: unknown; x: number; y: number }[] = []
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: (source: unknown, x: number, y: number) => {
        this.draws.push({ source, x, y })
      },
      putImageData: (image: FakeImageData, x: number, y: number) => {
        // Copied, because the real one takes the pixels into the canvas and the
        // caller's buffer is reused between segments. Holding the reference
        // would make every put ever recorded read as the most recent one.
        this.puts.push({
          image: new FakeImageData(new Uint8ClampedArray(image.data), image.width, image.height),
          x,
          y,
        })
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
      }),
    }
  }
  convertToBlob() {
    return Promise.resolve(new Blob([new Uint8Array([1])]))
  }
}

/** Both of the real constructor's forms: a blank one, and one over a buffer. */
class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a
      this.height = b
      this.data = new Uint8ClampedArray(a * b * 4)
    } else {
      this.data = a
      this.width = b
      this.height = c ?? 0
    }
  }
}

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('ImageData', FakeImageData)
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: () => {} }))
  vi.stubGlobal('window', {
    engine,
    api: {
      readImage: () => Promise.resolve(new Uint8Array([1])),
      writePage: () => Promise.resolve(),
      deleteLayerParts: () => Promise.resolve(),
      writeManifest: () => Promise.resolve(),
    },
  })
})

function raster(id: string, extra: Partial<RasterLayerEntry> = {}): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    effects: [],
    file: `${id}.png`,
    // No frame yet: a layer nothing has been written to, which is what the
    // brush most often meets and the case the frame has to grow from.
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    alphaLocked: false,
    ...extra,
  }
}

function folder(id: string, children: RasterLayerEntry[] = []): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'pass-through',
    effects: [],
    children,
  }
}

function openWith(...layers: (RasterLayerEntry | GroupLayerEntry)[]) {
  const project = useProjectStore()
  project.rootPath = '/root'
  project.allFiles = [
    {
      pageId: PAGE_ID,
      pageDir: `/root/shashoku/pages/${PAGE_ID}`,
      page: { ...defaultManifest('source', PAGE.w, PAGE.h), layers: [] },
      ocr: defaultOcr(PAGE.w, PAGE.h),
      badge: 'ok',
    },
  ]
  for (const layer of layers) project.addLayer(PAGE_ID, layer)
  const editor = useEditorStore()
  editor.currentPageId = PAGE_ID
  Object.assign(editor.view, { scale: 1, tx: 0, ty: 0, rotate: 0 })
  return { project, editor }
}

/**
 * A container whose box starts at the origin, so a client point is a page
 * point. Capture is tracked for real, rather than stubbed to a no-op, so a
 * release called on a pointer that was never captured — or already let go —
 * throws instead of passing silently.
 */
let capturedPointers = new Set<number>()
const container = ref({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: PAGE.w, height: PAGE.h }),
  setPointerCapture: (id: number) => {
    capturedPointers.add(id)
  },
  hasPointerCapture: (id: number) => capturedPointers.has(id),
  releasePointerCapture: (id: number) => {
    if (!capturedPointers.has(id)) throw new Error(`pointer ${id} was not captured`)
    capturedPointers.delete(id)
  },
} as unknown as HTMLElement)

function press(
  x: number,
  y: number,
  opts: { pointerId?: number; button?: number; pointerType?: string; pressure?: number } = {},
): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: opts.pointerId ?? 1,
    button: opts.button ?? 0,
    // A real mouse reports 0.5 while a button is down; carrying that through
    // by default means every stroke here doubles as a check that it never
    // reaches the brush's width.
    pointerType: opts.pointerType ?? 'mouse',
    pressure: opts.pressure ?? 0.5,
    currentTarget: container.value,
  } as unknown as PointerEvent
}

/**
 * A termination event — up, cancel, or a lost capture — for a given pointer.
 *
 * Without `at` it carries no position, the shape most of the suite's releases
 * take and which the brush treats as nothing to walk the tail to. With `at`
 * it is a release the hand actually moved to, position included and pressure
 * at the spec's fixed 0.
 */
function release(pointerId = 1, at?: { x: number; y: number }): PointerEvent {
  return {
    pointerId,
    clientX: at?.x,
    clientY: at?.y,
    pointerType: 'mouse',
    pressure: 0,
    currentTarget: container.value,
  } as unknown as PointerEvent
}

/**
 * A pen's own termination event — up, cancel, or a lost capture — at a real
 * position. `release()` above is shaped like a mouse's: this one carries the
 * pen's own `pointerType`, which is what lets the sampler's release-pressure
 * fallback (last valid reading, not the spec's fixed 0) actually be reached.
 */
function penRelease(pointerId: number, at: { x: number; y: number }): PointerEvent {
  return {
    pointerId,
    clientX: at.x,
    clientY: at.y,
    pointerType: 'pen',
    pressure: 0,
    currentTarget: container.value,
  } as unknown as PointerEvent
}

/**
 * A move event carrying a coalesced list, the shape `getCoalescedEvents()`
 * hands back on real hardware. Once the list is non-empty the handler reads
 * only it, so the event's own position is never asserted on here.
 */
function coalescedMove(
  points: { x: number; y: number; pointerId?: number }[],
  pointerId = 1,
): PointerEvent {
  const events = points.map((p) => press(p.x, p.y, { pointerId: p.pointerId ?? pointerId }))
  return {
    ...events[events.length - 1],
    getCoalescedEvents: () => events,
  } as unknown as PointerEvent
}

/** Long enough for the handover, the write and the save obligation to land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

async function stroke(
  brush: ReturnType<typeof useLayerBrush>,
  from: { x: number; y: number },
  to = from,
): Promise<void> {
  brush.onPointerDown(press(from.x, from.y))
  if (to !== from) brush.onPointerMove(press(to.x, to.y))
  brush.onPointerUp(release())
  await settle()
}

function selectRect(at: { x: number; y: number; w: number; h: number }): void {
  useSelectionStore().applyShape(PAGE, rasterizeRect(PAGE, at), 'new', 'test')
}

/**
 * A press whose handover has landed, which is what a stroke has by the time a
 * hand has moved at all — and what a preview needs before it can ask the engine
 * anything.
 */
async function pressAndSettle(
  brush: ReturnType<typeof useLayerBrush>,
  at: { x: number; y: number },
): Promise<void> {
  brush.onPointerDown(press(at.x, at.y))
  await settle()
}

/** The layer as the engine holds it — the pixels the previews stand in for. */
function layerPixels(id: string, at: { x: number; y: number; w: number; h: number }): Uint8Array {
  return engine.rasterRead(id, at)
}

beforeEach(() => {
  engine.maskReset()
  engine.rasterReleaseAll()
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  capturedPointers = new Set()
})

describe('which handler a press belongs to', () => {
  it('declines every tool that is not one of the two brushes', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('lasso')

    expect(useLayerBrush(container).onPointerDown(press(50, 50))).toBe(false)
  })

  /**
   * The same two tools point at the selection instead while Quick Mask is on,
   * which is the mask brush's press and not this one's.
   */
  it('declines while Quick Mask is on, however much the tool looks like its own', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().toggleQuickMask()

    expect(useLayerBrush(container).onPointerDown(press(50, 50))).toBe(false)
  })

  it('takes the press with a brush up and Quick Mask off', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')

    expect(useLayerBrush(container).onPointerDown(press(50, 50))).toBe(true)
  })
})

describe('what the brush refuses, and says', () => {
  it('says so when what is selected holds no pixels', () => {
    const { editor } = openWith(folder('g'))
    editor.selectOnly('g')
    editor.setTool('brush')

    expect(useLayerBrush(container).onPointerDown(press(50, 50))).toBe(true)
    expect(useNoticeStore().notice?.text).toBe('選一個點陣圖層再畫')
  })

  it('names the locked layer it will not draw on', () => {
    const { editor } = openWith(raster('r', { name: '底圖', locked: true }))
    editor.selectOnly('r')
    editor.setTool('brush')

    useLayerBrush(container).onPointerDown(press(50, 50))

    expect(useNoticeStore().notice?.text).toBe('「底圖」鎖定中，改不了')
  })

  it('names the hidden layer it will not draw on', () => {
    const { editor } = openWith(raster('r', { name: '塗白', visible: false }))
    editor.selectOnly('r')
    editor.setTool('brush')

    useLayerBrush(container).onPointerDown(press(50, 50))

    expect(useNoticeStore().notice?.text).toBe('「塗白」是隱藏的，改不了')
  })

  /** A refusal still belongs to this handler: falling through would start a
   * stroke on the mask or take hold of a layer instead. */
  it('takes the press it refuses rather than passing it on', () => {
    const { editor } = openWith(raster('r', { locked: true }))
    editor.selectOnly('r')
    editor.setTool('brush')

    expect(useLayerBrush(container).onPointerDown(press(50, 50))).toBe(true)
  })
})

describe('what a stroke leaves behind', () => {
  it('paints in the foreground colour, on the layer the cursor is on', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    editor.foreground = '#ff0000'
    useSelectionStore().brushes.paint.size = 4
    const fill = vi.spyOn(engine, 'rasterFill')

    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    expect(fill).toHaveBeenCalledTimes(1)
    expect(fill.mock.calls[0][0]).toBe('r')
    expect(fill.mock.calls[0][3]).toBe('#ff0000')
  })

  /**
   * A release waits on the handover, so the write runs some turns after the hand
   * let go — and by then the eyedropper is reachable again. What lands has to be
   * the colour the hand was watching go down.
   */
  it('writes the colour the press began in, not one picked while it settled', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    editor.foreground = '#ff0000'
    useSelectionStore().brushes.paint.size = 4
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(50, 50))
    brush.onPointerUp(release())
    editor.foreground = '#0000ff'
    await settle()

    expect([...layerPixels('r', { x: 50, y: 50, w: 1, h: 1 }).slice(0, 3)]).toEqual([0xff, 0, 0])
  })

  /**
   * The frame grows from the pixels rather than from the box handed over, so a
   * first stroke in the middle of the page does not drag a frame out of the
   * corner.
   */
  it('grows a frame that hugs the first stroke on a blank layer', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 4

    await stroke(useLayerBrush(container), { x: 200, y: 150 })

    const frame = useRasterStore().liveLayer('r')?.frame
    expect(frame).toBeDefined()
    expect(frame!.x).toBeGreaterThan(190)
    expect(frame!.y).toBeGreaterThan(140)
    expect(frame!.w).toBeLessThan(12)
    expect(frame!.h).toBeLessThan(12)
  })

  /**
   * The other direction of the same rule, and the one a hand notices: the frame
   * is what the layer tree's thumbnail is drawn into and what the canvas draws
   * an outline around, so a frame that grew and could not come back in leaves
   * both of them standing where the pixels no longer are.
   */
  it('pulls the frame back in when the eraser takes an edge away', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 8
    const brush = useLayerBrush(container)
    await stroke(brush, { x: 50, y: 50 }, { x: 150, y: 50 })
    const grown = useRasterStore().liveLayer('r')!.frame
    expect(grown.x + grown.w).toBeGreaterThan(150)

    editor.setTool('eraser')
    await stroke(useLayerBrush(container), { x: 150, y: 50 }, { x: 100, y: 50 })

    const pulled = useRasterStore().liveLayer('r')!.frame
    expect(pulled.x + pulled.w).toBeLessThan(grown.x + grown.w)
    expect(pulled.x).toBe(grown.x)
  })

  it('is one step however many segments it was drawn from', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(90, 50))
    brush.onPointerMove(press(110, 50))
    brush.onPointerUp(release())
    await settle()

    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(editor.canUndo).toBe(false)
  })

  it('undoes back to a layer with no frame at all', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')

    await stroke(useLayerBrush(container), { x: 50, y: 50 })
    expect(useRasterStore().liveLayer('r')?.frame.w).toBeGreaterThan(0)

    editor.undo()

    expect(useRasterStore().liveLayer('r')?.frame.w).toBe(0)
  })

  it('is not a step when the press drew nothing', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 0

    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    expect(editor.canUndo).toBe(false)
  })
})

describe('a selection bounds the stroke', () => {
  it('hands over no coverage outside the selection', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40
    selectRect({ x: 40, y: 40, w: 20, h: 20 })
    const fill = vi.spyOn(engine, 'rasterFill')

    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    const [, mask, frame] = fill.mock.calls[0]
    for (let row = 0; row < frame.h; row++) {
      for (let col = 0; col < frame.w; col++) {
        const inside =
          frame.x + col >= 40 && frame.x + col < 60 && frame.y + row >= 40 && frame.y + row < 60
        if (!inside) expect(mask[row * frame.w + col]).toBe(0)
      }
    }
  })

  /**
   * Deselecting is a key, and a key is reachable while the hand is holding the
   * pointer down. What the selection cut while it was up stays cut: it was drawn
   * that way and it was seen that way on the canvas.
   */
  it('keeps what was cut while the selection was up, when it comes down mid-stroke', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    const selection = useSelectionStore()
    selection.brushes.paint.size = 8
    selectRect({ x: 0, y: 0, w: 100, h: PAGE.h })
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(95, 50))
    brush.onPointerMove(press(115, 50))
    selection.deselect()
    brush.onPointerUp(release())
    await settle()

    expect(layerPixels('r', { x: 95, y: 50, w: 1, h: 1 })[3]).toBe(255)
    expect(layerPixels('r', { x: 110, y: 50, w: 1, h: 1 })[3]).toBe(0)
  })

  /** The other half of the same rule: from that moment on, the edge is gone. */
  it('lets the rest of the stroke past the edge once the selection comes down', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    const selection = useSelectionStore()
    selection.brushes.paint.size = 8
    selectRect({ x: 0, y: 0, w: 100, h: PAGE.h })
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(95, 50))
    brush.onPointerMove(press(97, 50))
    selection.deselect()
    brush.onPointerMove(press(150, 50))
    brush.onPointerUp(release())
    await settle()

    expect(layerPixels('r', { x: 150, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })

  it('leaves the frame inside the selection too', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40
    selectRect({ x: 40, y: 40, w: 20, h: 20 })

    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    const frame = useRasterStore().liveLayer('r')!.frame
    expect(frame.x).toBeGreaterThanOrEqual(40)
    expect(frame.y).toBeGreaterThanOrEqual(40)
    expect(frame.x + frame.w).toBeLessThanOrEqual(60)
    expect(frame.y + frame.h).toBeLessThanOrEqual(60)
  })
})

describe('the stroke as it is being drawn', () => {
  function open(frame: Partial<RasterLayerEntry> = {}) {
    const { editor, project } = openWith(raster('r', frame))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 8
    return { editor, project, brush: useLayerBrush(container) }
  }

  /** A layer whose frame already covers the page, so no stroke can move it. */
  const framed = { x: 0, y: 0, w: PAGE.w, h: PAGE.h }

  function overlay() {
    return useStrokeOverlayStore().overlayFor('r')
  }

  function shownCanvas(): FakeCanvas {
    return overlay()!.canvas as unknown as FakeCanvas
  }

  /**
   * What the overlay is showing at a page pixel, or null where nothing was put.
   *
   * The last put wins, because `putImageData` replaces rather than blends — and
   * that is right rather than lossy: coverage is accumulated in the stroke's
   * surface before a segment of it is drawn, so the newest put of a pixel
   * already carries everything older that reached it.
   */
  function shownAlpha(x: number, y: number): number | null {
    const shown = overlay()
    if (shown === null) return null
    const lx = x - shown.region.x
    const ly = y - shown.region.y
    let alpha: number | null = null
    for (const put of shownCanvas().puts) {
      const { width, height, data } = put.image
      if (lx < put.x || ly < put.y || lx >= put.x + width || ly >= put.y + height) continue
      alpha = data[((ly - put.y) * width + (lx - put.x)) * 4 + 3]
    }
    return alpha
  }

  it('shows the stroke before the button comes up', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })

    brush.onPointerMove(press(80, 50))

    expect(overlay()).not.toBeNull()
    expect(shownAlpha(65, 50)).toBe(255)
  })

  /**
   * The whole of why the overlay exists. Asking the engine what the layer would
   * look like meant a region of pixels back across the addon boundary on every
   * pointer event — megabytes a frame under a wide brush moving quickly, which
   * was the cost of the feature rather than a part of it.
   */
  it('asks the engine nothing at all until the button comes up', async () => {
    const { brush } = open(framed)
    await pressAndSettle(brush, { x: 50, y: 50 })
    const fill = vi.spyOn(engine, 'rasterFill')
    const erase = vi.spyOn(engine, 'rasterErase')
    const read = vi.spyOn(engine, 'rasterRead')

    brush.onPointerMove(press(60, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(80, 50))

    expect(fill).not.toHaveBeenCalled()
    expect(erase).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  /**
   * And so the first mark of the first stroke on a layer does not wait for the
   * handover. Nothing on screen needs the engine to have the pixels, which is
   * what used to make a press on an untouched layer sit blank until its copy
   * had crossed over.
   */
  it('shows the first mark while the handover is still in flight', () => {
    // A layer with pixels to hand over, so the handover is a file read and a
    // decode rather than the empty one a blank layer finishes on the spot.
    const { brush } = open(framed)
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))

    expect(useRasterStore().holds('r')).toBe(false)
    expect(shownAlpha(60, 50)).toBe(255)
  })

  /**
   * The preview is worked out and thrown away. Nothing it shows is in the
   * layer, and nothing it shows can be undone, because there is no step there
   * to undo.
   */
  it('leaves the committed layer and the undo stack alone all the way', async () => {
    const { editor, brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const before = layerPixels('r', { x: 40, y: 40, w: 40, h: 20 })

    brush.onPointerMove(press(60, 50))
    brush.onPointerMove(press(70, 50))

    expect([...layerPixels('r', { x: 40, y: 40, w: 40, h: 20 })]).toEqual([...before])
    expect(editor.canUndo).toBe(false)
  })

  /**
   * The overlay's alpha is the stroke's coverage, and so is the alpha a fill
   * leaves on a layer that had nothing there. The two are worked out from one
   * surface by one stamp, which is what keeps the release from moving what the
   * hand had settled on.
   */
  it('agrees with the committed layer once the button comes up', async () => {
    const { editor, brush } = open()
    editor.foreground = '#3366ff'
    // Wide enough that the falloff is a band rather than a single pixel, so
    // the value compared below is one the two could disagree about.
    useSelectionStore().brushes.paint.size = 40
    await pressAndSettle(brush, { x: 50, y: 50 })

    brush.onPointerMove(press(70, 50))
    const rim = shownAlpha(60, 68)
    expect(shownAlpha(60, 50)).toBe(255)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)

    brush.onPointerUp(release())
    await settle()

    const written = layerPixels('r', { x: 60, y: 68, w: 1, h: 1 })
    expect(written[3]).toBe(rim)
    expect([...written.slice(0, 3)]).toEqual([0x33, 0x66, 0xff])
  })

  /**
   * The rail is reachable while the hand is down, so a slider dragged
   * mid-stroke must not change the head partway through a line already begun.
   */
  it('paints with the size it had at the press, not one changed mid-stroke', async () => {
    const { brush } = open()
    const selection = useSelectionStore()
    selection.brushes.paint.size = 40
    await pressAndSettle(brush, { x: 50, y: 50 })

    selection.brushes.paint.size = 4
    brush.onPointerMove(press(70, 50))

    // A radius of 20 reaches 18 px off the centreline; a radius of 2 would not.
    expect(shownAlpha(60, 68)).toBeGreaterThan(0)
  })

  /**
   * A mouse reports `pressure` 0.5 while a button is down — the Pointer
   * Events spec's placeholder for a device with no pressure support — and
   * `press()` carries that through by default, so this exercises the real
   * shape of a mouse event rather than a pressure of 1 picked to dodge it.
   */
  it('paints a mouse stroke at its nominal width, not halved by the 0.5 mice report', async () => {
    const { brush } = open()
    useSelectionStore().brushes.paint.size = 40
    await pressAndSettle(brush, { x: 50, y: 50 })

    // A radius of 20 reaches 18 px off the centreline; a radius of 10, halved
    // by the 0.5, would not.
    expect(shownAlpha(68, 50)).toBeGreaterThan(0)
  })

  /**
   * A pen reports `pressure` 0 at `pointerdown` — measured against real
   * hardware, not a placeholder like the mouse's 0.5 above — before its own
   * contact force has been sampled at all.
   */
  it('does not paint a full-nominal-width dot at the press when a pen opens at pressure 0', () => {
    const { brush } = open()
    useSelectionStore().brushes.paint.size = 40
    brush.onPointerDown(press(50, 50, { pointerType: 'pen', pressure: 0 }))

    expect(shownAlpha(50, 50)).toBeFalsy()
  })

  /**
   * Which of the two directions a stroke is decides nothing about the coverage
   * and everything about how it meets the layer. These three operators are the
   * canvas's account of what the release will do.
   */
  it('punches through for the eraser rather than painting over', async () => {
    const { editor, brush } = open()
    editor.foreground = '#ffffff'
    await stroke(brush, { x: 50, y: 50 }, { x: 90, y: 50 })

    editor.setTool('eraser')
    const eraser = useLayerBrush(container)
    await pressAndSettle(eraser, { x: 70, y: 50 })
    eraser.onPointerMove(press(72, 50))

    expect(overlay()!.op).toBe('destination-out')
    expect(shownAlpha(71, 50)).toBe(255)
  })

  it('holds paint to what is there when the layer locks its transparency', async () => {
    const { project, brush } = open(framed)
    project.setLayerAlphaLocked(PAGE_ID, 'r', true)
    await pressAndSettle(brush, { x: 50, y: 50 })

    expect(overlay()!.op).toBe('source-atop')
  })

  it('paints straight over when nothing is locked', async () => {
    const { brush } = open(framed)
    await pressAndSettle(brush, { x: 50, y: 50 })

    expect(overlay()!.op).toBe('source-over')
  })

  /**
   * The layer under a stroke is not touched at all, so a frame cannot move
   * under the hand that is drawing on it. This was the failure the overlay
   * makes structural rather than guarded against: the renderer's copy of a
   * layer is rebuilt whenever its frame changes, and a preview standing on a
   * frame the release then disagreed with had that copy thrown away with only
   * the tiles the write touched put back.
   */
  it('never moves the layer while the stroke is being drawn', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const stood = { ...useRasterStore().liveLayer('r')!.frame }

    brush.onPointerMove(press(120, 50))
    brush.onPointerMove(press(190, 62))

    expect(useRasterStore().liveLayer('r')!.frame).toEqual(stood)
  })

  /**
   * The overlay grows with the stroke's surface rather than on a scheme of its
   * own, so a pixel has one place in both. Growing carries the old canvas over:
   * everything drawn so far lives there and nowhere else.
   */
  it('carries what it has drawn onto the canvas it grows into', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const was = overlay()!
    const wasCanvas = was.canvas

    brush.onPointerMove(press(190, 50))

    const now = overlay()!
    expect(now.canvas).not.toBe(wasCanvas)
    expect((now.canvas as unknown as FakeCanvas).draws[0]).toEqual({
      source: wasCanvas,
      x: was.region.x - now.region.x,
      y: was.region.y - now.region.y,
    })
  })

  /**
   * And it says so to anything tracking it. The stack reads the overlay while
   * it renders, so a growth that swapped the canvas without a signal would
   * leave it drawing the one from before — which is the whole stroke frozen at
   * whatever it had reached.
   */
  it('changes what a tracked read sees when it grows onto a new canvas', async () => {
    const { brush } = open()
    const seen = computed(() => useStrokeOverlayStore().overlayFor('r'))
    expect(seen.value).toBeNull()

    await pressAndSettle(brush, { x: 50, y: 50 })
    const first = seen.value
    expect(first).not.toBeNull()

    brush.onPointerMove(press(190, 50))

    expect(seen.value).not.toBe(first)
    expect(seen.value!.region.w).toBeGreaterThan(first!.region.w)
  })

  /**
   * Everything that reads a canvas back to build itself hangs off this. A
   * stroke shown as a write would have those readbacks run per pointer event,
   * and reading a whole canvas back is more than a frame's worth of time on a
   * layer of any size.
   */
  it('says nothing was written, or even drawn, on the layer until it commits', async () => {
    const raster = useRasterStore()
    const shown = useStrokeOverlayStore()
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const written = raster.committed
    const drawn = raster.revision
    const showings = shown.revision

    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(90, 50))
    brush.onPointerMove(press(110, 50))

    // Shown three times over, and the layer told about none of them.
    expect(shown.revision).toBeGreaterThan(showings)
    expect(raster.revision).toBe(drawn)
    expect(raster.committed).toBe(written)

    brush.onPointerUp(release())
    await settle()

    expect(raster.committed).toBeGreaterThan(written)
  })

  /**
   * A handover reads a file and decodes it, so "is it held" answers no for the
   * whole of that. Two quick presses would both cross over, and the one that
   * landed second would put the file's pixels back over whatever the first had
   * already committed.
   */
  it('hands a layer over once however many strokes reach for it at the same time', async () => {
    const { brush } = open(framed)
    const handed = vi.spyOn(engine, 'rasterTake')

    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerUp(release())
    brush.onPointerDown(press(120, 50))
    brush.onPointerMove(press(140, 50))
    brush.onPointerUp(release())
    await settle()

    expect(handed).toHaveBeenCalledTimes(1)
  })

  /**
   * A release waits on that handover, so it outlives the hand that drew it —
   * long enough for the next press to have taken the overlay. Only the stroke
   * still holding it may put it down.
   */
  it('does not let a stroke that has finished take down the one after it', async () => {
    const { brush } = open(framed)
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerUp(release())

    // The release is queued behind the handover; this press lands first.
    brush.onPointerDown(press(120, 50))
    brush.onPointerMove(press(140, 50))
    await settle()

    expect(overlay()).not.toBeNull()
    expect(shownAlpha(130, 50)).toBe(255)
  })

  /**
   * A layer whose pixels cannot be read is not a layer that can be painted, and
   * the picture has to say so. Leaving the overlay up would leave the stroke
   * plainly on screen with nothing behind it in the layer or the stack.
   */
  it('takes the overlay down when the handover never lands', async () => {
    const { brush } = open(framed)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window.api, 'readImage').mockRejectedValue(new Error('no such layer file'))

    await stroke(brush, { x: 50, y: 50 }, { x: 70, y: 50 })

    expect(overlay()).toBeNull()
    expect(useStrokeOverlayStore().layerId).toBeNull()
  })

  /** And the overlay goes when the write it stood in for arrives. */
  it('takes the overlay down at the release', async () => {
    const { brush } = open()
    await stroke(brush, { x: 50, y: 50 }, { x: 90, y: 50 })

    expect(overlay()).toBeNull()
    expect(useStrokeOverlayStore().layerId).toBeNull()
  })

  it('takes it down after a press that drew nothing', async () => {
    const { brush } = open()
    useSelectionStore().brushes.paint.size = 0
    await stroke(brush, { x: 50, y: 50 })

    expect(overlay()).toBeNull()
  })

  it('does not rebuild the layer underneath when the stroke commits', async () => {
    const { brush } = open(framed)
    await pressAndSettle(brush, { x: 50, y: 50 })
    brush.onPointerMove(press(70, 50))
    const canvas = useRasterStore().liveLayer('r')!.canvas

    brush.onPointerUp(release())
    await settle()

    // The same canvas, so nothing shown on it was thrown away to make room.
    expect(useRasterStore().liveLayer('r')!.canvas).toBe(canvas)
  })

  /**
   * On a layer the stroke does grow, the release hands the whole frame back —
   * the rebuild that causes is fed everything rather than a few tiles.
   */
  it('is handed the whole frame by the release that moved it', async () => {
    const { brush } = open()
    const fill = vi.spyOn(engine, 'rasterFill')

    await pressAndSettle(brush, { x: 50, y: 50 })
    brush.onPointerMove(press(90, 62))
    brush.onPointerUp(release())
    await settle()

    const patch = fill.mock.results[0].value as EngineLayerPixels
    expect(patch.changed).toEqual(patch.frame)
  })

  /**
   * A stroke the selection cuts away entirely shows nothing, and commits
   * nothing — so it must not leave the layer's frame grown by what it drew on
   * the way.
   */
  it('shows nothing, and grows nothing, outside the selection', async () => {
    const { brush } = open()
    selectRect({ x: 200, y: 200, w: 20, h: 20 })

    await pressAndSettle(brush, { x: 50, y: 50 })
    brush.onPointerMove(press(70, 50))

    expect(shownAlpha(60, 50)).toBe(0)
    expect(useRasterStore().liveLayer('r')?.frame.w).toBe(0)
  })
})

describe("the layer's own alpha lock", () => {
  it('is honoured by the brush', async () => {
    const { editor } = openWith(raster('r', { alphaLocked: true }))
    editor.selectOnly('r')
    editor.setTool('brush')
    const fill = vi.spyOn(engine, 'rasterFill')

    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    expect(fill.mock.calls[0][4]).toBe(true)
  })

  /**
   * Read at the press for the same reason the colour is: the layer tree is
   * clickable again the moment the hand comes up, while the write is still
   * waiting on the handover.
   */
  it('goes by the lock as it stood at the press, not as it stands at the write', async () => {
    const { editor, project } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    const fill = vi.spyOn(engine, 'rasterFill')
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(50, 50))
    brush.onPointerUp(release())
    project.setLayerAlphaLocked(PAGE_ID, 'r', true)
    await settle()

    expect(fill.mock.calls[0][4]).toBe(false)
  })

  /**
   * The eraser goes through it. There is no fill for a lock to hold back — only
   * a hole — which is the same reason erasing has nothing of its own in the
   * data model.
   */
  it('has nothing to say to the eraser, which punches through regardless', async () => {
    const { editor, project } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    // Something to erase. The lock goes on afterwards, since paint under one
    // lands only where there are already pixels and a blank layer has none.
    await stroke(useLayerBrush(container), { x: 50, y: 50 })
    project.setLayerAlphaLocked(PAGE_ID, 'r', true)

    editor.setTool('eraser')
    const erase = vi.spyOn(engine, 'rasterErase')
    const fill = vi.spyOn(engine, 'rasterFill')
    await stroke(useLayerBrush(container), { x: 50, y: 50 })

    expect(erase).toHaveBeenCalledTimes(1)
    expect(fill).not.toHaveBeenCalled()
  })
})

describe('what a write wakes', () => {
  const framed = { x: 0, y: 0, w: PAGE.w, h: PAGE.h }

  /**
   * Everything that reads a whole canvas back — the hit-test plane, a row's
   * thumbnail, the wand's composite — hangs off the count of writes to the
   * layer it is about. Off a count of writes to the document, a stroke anywhere
   * threw all of them away: every held layer re-read, every row on the page
   * back to disk, for pixels that had not moved.
   */
  it('leaves a layer alone when the stroke was on a different one', async () => {
    const { editor } = openWith(raster('a', framed), raster('b', framed))
    editor.setTool('brush')
    const raster_ = useRasterStore()

    let woke = 0
    const stop = watch(() => raster_.writesTo('a'), () => (woke += 1), { flush: 'sync' })

    editor.selectOnly('b')
    await stroke(useLayerBrush(container), { x: 50, y: 50 }, { x: 90, y: 50 })
    expect(raster_.writesTo('b')).toBeGreaterThan(0)
    expect(woke).toBe(0)

    editor.selectOnly('a')
    await stroke(useLayerBrush(container), { x: 50, y: 90 }, { x: 90, y: 90 })
    expect(woke).toBe(1)

    stop()
  })
})

describe('a stroke belongs to the pointer that opened it', () => {
  function openBrush(size = 8) {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = size
    return { editor, brush: useLayerBrush(container) }
  }

  it('ignores a second pointer down while one stroke is under way', async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50, { pointerId: 1 }))

    expect(brush.onPointerDown(press(200, 50, { pointerId: 2 }))).toBe(true)

    brush.onPointerMove(press(70, 50, { pointerId: 1 }))
    brush.onPointerUp(release(1))
    await settle()

    expect(layerPixels('r', { x: 200, y: 50, w: 1, h: 1 })[3]).toBe(0)
    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })

  it("a foreign pointer's move produces no dab", async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50, { pointerId: 1 }))

    expect(brush.onPointerMove(press(200, 50, { pointerId: 2 }))).toBe(true)

    brush.onPointerMove(press(70, 50, { pointerId: 1 }))
    brush.onPointerUp(release(1))
    await settle()

    expect(layerPixels('r', { x: 200, y: 50, w: 1, h: 1 })[3]).toBe(0)
  })

  it("a foreign pointer's up does not end the stroke", async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50, { pointerId: 1 }))
    brush.onPointerMove(press(70, 50, { pointerId: 1 }))

    expect(brush.onPointerUp(release(2))).toBe(false)

    brush.onPointerUp(release(1))
    await settle()

    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })
})

describe('the three ways a stroke ends', () => {
  function openBrush(size = 8) {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = size
    return { editor, brush: useLayerBrush(container) }
  }

  it('banks what was drawn, at the last known position, when the pointer is cancelled', async () => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))

    brush.onPointerCancel(release())
    await settle()

    expect(editor.canUndo).toBe(true)
    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })

  it('banks what was drawn when the pointer loses capture', async () => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))

    brush.onLostPointerCapture(release())
    await settle()

    expect(editor.canUndo).toBe(true)
    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })

  it('ends at most once, whichever of the three arrives first', async () => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))

    expect(brush.onPointerUp(release())).toBe(true)
    expect(brush.onPointerCancel(release())).toBe(false)
    expect(brush.onLostPointerCapture(release())).toBe(false)
    await settle()

    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(editor.canUndo).toBe(false)
  })

  it('is not a step when a cancelled press drew nothing', async () => {
    const { editor, brush } = openBrush(0)
    brush.onPointerDown(press(50, 50))

    brush.onPointerCancel(release())
    await settle()

    expect(editor.canUndo).toBe(false)
  })

  /**
   * `lostpointercapture` fires only once the browser has already let go, so
   * the guard that asks before releasing has to hold for that case too rather
   * than assume the press always still owns it.
   */
  it('asks before releasing capture rather than assuming it is held', async () => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    container.value.releasePointerCapture(1)

    expect(() => brush.onLostPointerCapture(release())).not.toThrow()
    await settle()

    expect(editor.canUndo).toBe(true)
  })
})

describe('undo and redo refuse a stroke in flight', () => {
  function openBrush(size = 8) {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = size
    return { editor, brush: useLayerBrush(container) }
  }

  it('takes nothing back while a stroke is under way', async () => {
    const { editor, brush } = openBrush()
    await stroke(brush, { x: 50, y: 50 })
    expect(editor.canUndo).toBe(true)

    brush.onPointerDown(press(150, 50))
    brush.onPointerMove(press(160, 50))
    editor.undo()

    expect(editor.canRedo).toBe(false)
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBeGreaterThan(0)

    brush.onPointerUp(release())
    await settle()
  })

  it('puts nothing back while a stroke is under way', async () => {
    const { editor, brush } = openBrush()
    await stroke(brush, { x: 50, y: 50 })
    editor.undo()
    expect(editor.canRedo).toBe(true)
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBe(0)

    brush.onPointerDown(press(150, 50))
    brush.onPointerMove(press(160, 50))
    editor.redo()

    expect(editor.canUndo).toBe(false)
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBe(0)

    brush.onPointerUp(release())
    await settle()
  })

  it('undoes normally again once the stroke has ended', async () => {
    const { editor, brush } = openBrush()
    await stroke(brush, { x: 50, y: 50 })
    expect(editor.canUndo).toBe(true)

    editor.undo()

    expect(editor.canUndo).toBe(false)
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBe(0)
  })

  /**
   * Release waits on the commit the same way a stroke's own end does, so a
   * key pressed the instant the pointer comes up still has to reach past it —
   * the case the redo stack used to lose a stroke over, before it could land.
   */
  it('stays blocked until the commit lands, not merely until the pointer comes up', async () => {
    const { editor, brush } = openBrush()
    await stroke(brush, { x: 50, y: 50 })
    expect(editor.canUndo).toBe(true)

    brush.onPointerDown(press(150, 50))
    brush.onPointerMove(press(160, 50))
    brush.onPointerUp(release())

    editor.undo()
    expect(editor.canRedo).toBe(false)

    await settle()

    editor.undo()
    expect(editor.canRedo).toBe(true)
  })

  type Brush = ReturnType<typeof useLayerBrush>

  it.each([
    ['pointerup', (b: Brush) => b.onPointerUp(release())],
    ['pointercancel', (b: Brush) => b.onPointerCancel(release())],
    ['lostpointercapture', (b: Brush) => b.onLostPointerCapture(release())],
  ] as const)('releases it on %s', async (_label, end) => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    expect(editor.strokeInFlight).toBe(true)

    end(brush)
    await settle()

    expect(editor.strokeInFlight).toBe(false)
    await stroke(brush, { x: 90, y: 50 })
    expect(editor.canRedo).toBe(false)
    editor.undo()
    expect(editor.canRedo).toBe(true)
  })

  it('releases it even when the commit throws', async () => {
    const { editor, brush } = openBrush()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fill = vi.spyOn(engine, 'rasterFill').mockImplementation(() => {
      throw new Error('engine refused')
    })

    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerUp(release())
    await settle()

    expect(editor.strokeInFlight).toBe(false)

    fill.mockRestore()
    await stroke(brush, { x: 90, y: 50 })
    expect(editor.canUndo).toBe(true)
  })

  /**
   * A stroke's commit outlives its release, so a second press can open
   * before the first one's has landed — the same overlap
   * 'does not let a stroke that has finished take down the one after it'
   * exercises for the overlay. `strokesInFlight` has to be a count for this:
   * a flag would go false the instant the first stroke's commit lands, even
   * though the second is still being drawn.
   */
  it('stays blocked once an earlier stroke commits while a second stroke is still being drawn', async () => {
    const { editor, brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerUp(release())

    // The first stroke's commit is still queued behind its handover; this
    // press opens before it has landed rather than after `settle()`.
    brush.onPointerDown(press(150, 50))
    brush.onPointerMove(press(160, 50))
    await settle()

    // The first stroke has committed by now; the second is still open with
    // no pointerup of its own.
    expect(editor.canUndo).toBe(true)
    expect(editor.strokeInFlight).toBe(true)

    editor.undo()

    expect(editor.canRedo).toBe(false)
    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBeGreaterThan(0)

    brush.onPointerUp(release())
    await settle()
  })

  it('leaves undo and redo alone when no stroke is under way', async () => {
    const { editor, brush } = openBrush()
    expect(editor.strokeInFlight).toBe(false)

    await stroke(brush, { x: 50, y: 50 })
    expect(editor.canUndo).toBe(true)

    editor.undo()
    expect(editor.canUndo).toBe(false)
    expect(editor.canRedo).toBe(true)

    editor.redo()
    expect(editor.canRedo).toBe(false)
    expect(editor.canUndo).toBe(true)
  })
})

describe('the release walks the tail to its own position', () => {
  function openBrush(size = 8) {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = size
    return { editor, brush: useLayerBrush(container) }
  }

  it('paints past the last move, out to where the pointer came up', async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(60, 50))
    brush.onPointerUp(release(1, { x: 90, y: 50 }))
    await settle()

    expect(layerPixels('r', { x: 90, y: 50, w: 1, h: 1 })[3]).toBeGreaterThan(0)
  })

  it('does nothing extra for a release with no position, as most of this suite sends', async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(60, 50))

    expect(() => brush.onPointerUp(release())).not.toThrow()
    await settle()

    expect(layerPixels('r', { x: 90, y: 50, w: 1, h: 1 })[3]).toBe(0)
  })
})

/**
 * The pointer Events spec fixes a release's own `pressure` at 0, and
 * `endIfMine` walks the tail from it anyway — the sampler is the one that
 * substitutes the last valid pressure back in, exactly as it does for any
 * mid-stroke sample reporting 0. Nothing before this exercised that fallback
 * through the composable: every pen-typed event elsewhere in this file is a
 * `press()`, and the sampler's own unit test drives `end()` directly,
 * bypassing `pressureFrom` and `useLayerBrush` entirely.
 */
describe("a pen's release keeps the tail at its own last pressure", () => {
  it('does not widen the tail to full nominal width, or drop it to nothing, at a release reporting pressure 0', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(50, 50, { pointerType: 'pen', pressure: 0.15 }))
    brush.onPointerMove(press(150, 50, { pointerType: 'pen', pressure: 0.15 }))
    brush.onPointerUp(penRelease(1, { x: 200, y: 50 }))
    await settle()

    // Radius 20 at the nominal, full-pressure width reaches 15 px off the
    // centreline; radius 3, what 0.15 of it scales to, does not — so this
    // would fail if the release's 0 were forced to full pressure instead of
    // falling back to the last real reading.
    expect(layerPixels('r', { x: 200, y: 65, w: 1, h: 1 })[3]).toBe(0)
    // And this would fail if the release's 0 were taken at face value: a
    // radius-0 dab draws nothing, leaving the segment right before the
    // release as blank as the one after it.
    expect(layerPixels('r', { x: 198, y: 50, w: 1, h: 1 })[3]).toBeGreaterThan(0)
  })
})

describe("the pen's eraser end", () => {
  it('freezes to erase at the press while a mask brush tool is on the rail, and does not re-read the tool mid-stroke', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 8
    await stroke(useLayerBrush(container), { x: 50, y: 50 }, { x: 90, y: 50 })
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBeGreaterThan(0)

    const erase = vi.spyOn(engine, 'rasterErase')
    const fill = vi.spyOn(engine, 'rasterFill')
    const brush = useLayerBrush(container)
    brush.onPointerDown(press(50, 50, { button: 5 }))
    // Switched away from a mask brush entirely, which a live re-read of the
    // tool would have to treat as a decline — the frozen mode does not.
    editor.setTool('lasso')
    brush.onPointerMove(press(90, 50, { button: 5 }))
    brush.onPointerUp(release())
    await settle()

    expect(erase).toHaveBeenCalledTimes(1)
    expect(fill).not.toHaveBeenCalled()
    expect(layerPixels('r', { x: 50, y: 50, w: 1, h: 1 })[3]).toBe(0)
  })

  /**
   * CSP's own tail-switch binding (Modifier Key Settings) is per tool: a
   * Pen-family tool's tail is the eraser, but a Figure or Selected-area tool's
   * stays that tool. The eraser end only ever freezes a stroke that a mask
   * brush would already have started.
   */
  it('declines when no mask brush tool is on the rail, even at button 5', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('lasso')
    const brush = useLayerBrush(container)
    const erase = vi.spyOn(engine, 'rasterErase')
    const fill = vi.spyOn(engine, 'rasterFill')

    expect(brush.onPointerDown(press(50, 50, { button: 5 }))).toBe(false)
    expect(brush.onPointerMove(press(70, 50, { button: 5 }))).toBe(false)
    brush.onPointerUp(release())
    await settle()

    expect(erase).not.toHaveBeenCalled()
    expect(fill).not.toHaveBeenCalled()
    expect(useRasterStore().holds('r')).toBe(false)
  })

  it('does not enter while Quick Mask is on', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().toggleQuickMask()

    expect(useLayerBrush(container).onPointerDown(press(50, 50, { button: 5 }))).toBe(false)
  })

  it('declines any button that is neither the tip nor the eraser end', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')

    expect(useLayerBrush(container).onPointerDown(press(50, 50, { button: 2 }))).toBe(false)
  })
})

/**
 * The first invariant in `Shashoku-Plan`'s pixel-basics/brush spec: a gesture's
 * pixels do not depend on how the browser sliced it into pointer events. The
 * sampler test file proves the dabs it produces are split-independent on their
 * own terms; this proves the assembly — sampler, stamp, cut, commit — agrees
 * down to the byte once real engine tiles are on the other end.
 */
describe('the same gesture split into different pointer events', () => {
  type Vertex = { x: number; y: number }

  function lerp(a: Vertex, b: Vertex, t: number): Vertex {
    // Exact at the endpoints, so every splitting below still passes through
    // the same vertices rather than a floating-point neighbour of them.
    if (t === 0) return { x: a.x, y: a.y }
    if (t === 1) return { x: b.x, y: b.y }
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }

  /** The same path, walked through extra colinear points — what a slower or
   * faster event rate looks like for one continuous gesture. */
  function expand(vertices: Vertex[], fractions: number[]): Vertex[] {
    const out = [vertices[0]]
    for (let i = 0; i < vertices.length - 1; i++) {
      for (const t of fractions) out.push(lerp(vertices[i], vertices[i + 1], t))
    }
    return out
  }

  const vertices: Vertex[] = [
    { x: 60, y: 60 },
    { x: 140, y: 60 },
    { x: 140, y: 150 },
    { x: 90, y: 110 },
  ]

  async function paint(
    editor: ReturnType<typeof useEditorStore>,
    id: string,
    points: Vertex[],
  ): Promise<void> {
    editor.selectOnly(id)
    const brush = useLayerBrush(container)
    brush.onPointerDown(press(points[0].x, points[0].y))
    for (let i = 1; i < points.length; i++) brush.onPointerMove(press(points[i].x, points[i].y))
    brush.onPointerUp(release())
    await settle()
  }

  it('leaves byte-identical tiles whether the samples arrive whole, one at a time, unevenly split, or with zero-length samples mixed in', async () => {
    const { editor } = openWith(raster('a'), raster('b'), raster('c'), raster('d'))
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40

    const wholeSegments = vertices
    const onePointAtATime = expand(vertices, [0.25, 0.5, 0.75, 1])
    const unevenSplit = expand(vertices, [0.12, 0.31, 0.47, 0.73, 0.9, 1])
    const withZeroLengthSamples = onePointAtATime.flatMap((p, i) =>
      i > 0 && i % 3 === 0 ? [p, p] : [p],
    )

    await paint(editor, 'a', wholeSegments)
    await paint(editor, 'b', onePointAtATime)
    await paint(editor, 'c', unevenSplit)
    await paint(editor, 'd', withZeroLengthSamples)

    const region = { x: 0, y: 0, w: 200, h: 200 }
    const reference = [...layerPixels('a', region)]
    expect([...layerPixels('b', region)]).toEqual(reference)
    expect([...layerPixels('c', region)]).toEqual(reference)
    expect([...layerPixels('d', region)]).toEqual(reference)
  })
})

/**
 * The same invariant once radius no longer holds still along the gesture: an
 * extra point inserted for a finer splitting has to interpolate pressure
 * exactly as it interpolates position, or the two splittings describe
 * different gestures and byte-identity would be the wrong thing to ask for.
 */
describe('the same gesture split into different pointer events, pressure varying along it', () => {
  type Vertex = { x: number; y: number; pressure: number }

  function lerp(a: Vertex, b: Vertex, t: number): Vertex {
    if (t === 0) return { ...a }
    if (t === 1) return { ...b }
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      pressure: a.pressure + (b.pressure - a.pressure) * t,
    }
  }

  function expand(vertices: Vertex[], fractions: number[]): Vertex[] {
    const out = [vertices[0]]
    for (let i = 0; i < vertices.length - 1; i++) {
      for (const t of fractions) out.push(lerp(vertices[i], vertices[i + 1], t))
    }
    return out
  }

  const vertices: Vertex[] = [
    { x: 60, y: 60, pressure: 0.2 },
    { x: 140, y: 60, pressure: 0.9 },
    { x: 140, y: 150, pressure: 0.35 },
    { x: 90, y: 110, pressure: 0.75 },
  ]

  async function paint(
    editor: ReturnType<typeof useEditorStore>,
    id: string,
    points: Vertex[],
  ): Promise<void> {
    editor.selectOnly(id)
    const brush = useLayerBrush(container)
    brush.onPointerDown(
      press(points[0].x, points[0].y, { pointerType: 'pen', pressure: points[0].pressure }),
    )
    for (let i = 1; i < points.length; i++) {
      const p = points[i]
      brush.onPointerMove(press(p.x, p.y, { pointerType: 'pen', pressure: p.pressure }))
    }
    brush.onPointerUp(release())
    await settle()
  }

  it('leaves byte-identical tiles whether the samples arrive whole, one at a time, or unevenly split', async () => {
    const { editor } = openWith(raster('a'), raster('b'), raster('c'))
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40

    const wholeSegments = vertices
    const onePointAtATime = expand(vertices, [0.25, 0.5, 0.75, 1])
    const unevenSplit = expand(vertices, [0.12, 0.31, 0.47, 0.73, 0.9, 1])

    await paint(editor, 'a', wholeSegments)
    await paint(editor, 'b', onePointAtATime)
    await paint(editor, 'c', unevenSplit)

    const region = { x: 0, y: 0, w: 200, h: 200 }
    const reference = [...layerPixels('a', region)]
    expect([...layerPixels('b', region)]).toEqual(reference)
    expect([...layerPixels('c', region)]).toEqual(reference)
  })
})

describe("a move event's coalesced points", () => {
  function openBrush(size = 8) {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = size
    return { editor, brush: useLayerBrush(container) }
  }

  function shownCanvas(id: string): FakeCanvas {
    return useStrokeOverlayStore().overlayFor(id)!.canvas as unknown as FakeCanvas
  }

  /**
   * A path that bends partway through, so the batch cannot be bounded by the
   * straight line between where it started and where it ended — the case
   * that would have clipped part of the stamp if the window still came from
   * the segment's endpoints rather than from the dabs themselves.
   */
  const bentPath = [
    { x: 60, y: 60 },
    { x: 140, y: 60 },
    { x: 140, y: 150 },
    { x: 90, y: 110 },
  ]

  it('lands the same pixels as the same points delivered one move at a time', async () => {
    const { editor } = openWith(raster('coalesced'), raster('separate'))
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40

    editor.selectOnly('coalesced')
    const batched = useLayerBrush(container)
    batched.onPointerDown(press(bentPath[0].x, bentPath[0].y))
    batched.onPointerMove(coalescedMove(bentPath.slice(1)))
    batched.onPointerUp(release())
    await settle()

    editor.selectOnly('separate')
    const single = useLayerBrush(container)
    single.onPointerDown(press(bentPath[0].x, bentPath[0].y))
    for (const p of bentPath.slice(1)) single.onPointerMove(press(p.x, p.y))
    single.onPointerUp(release())
    await settle()

    const region = { x: 0, y: 0, w: 200, h: 200 }
    expect([...layerPixels('coalesced', region)]).toEqual([...layerPixels('separate', region)])
  })

  it('runs the growth, the cut and the preview once for a whole batch, not once per sample', async () => {
    const { brush } = openBrush()
    await pressAndSettle(brush, { x: 100, y: 100 })
    // Grows the surface out to where the batch below will stay inside it, so
    // the batch itself is the only thing left that could add another put.
    brush.onPointerMove(press(160, 100))
    const before = shownCanvas('r').puts.length

    brush.onPointerMove(
      coalescedMove([
        { x: 110, y: 100 },
        { x: 120, y: 100 },
        { x: 130, y: 100 },
        { x: 140, y: 100 },
        { x: 150, y: 100 },
      ]),
    )

    expect(shownCanvas('r').puts.length).toBe(before + 1)
  })

  it("drops a coalesced sample whose pointerId is not the stroke's", async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50, { pointerId: 1 }))

    brush.onPointerMove(
      coalescedMove([
        { x: 200, y: 50, pointerId: 2 },
        { x: 70, y: 50, pointerId: 1 },
      ]),
    )
    brush.onPointerUp(release(1))
    await settle()

    expect(layerPixels('r', { x: 200, y: 50, w: 1, h: 1 })[3]).toBe(0)
    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })

  it('keeps a non-finite sample from reaching the sampler, without losing the rest of the batch', async () => {
    const { brush } = openBrush()
    brush.onPointerDown(press(50, 50))

    const bad = { ...press(50, 50), clientX: NaN, clientY: Infinity }
    const good = press(70, 50)
    const batch = { ...good, getCoalescedEvents: () => [bad, good] } as unknown as PointerEvent

    expect(() => brush.onPointerMove(batch)).not.toThrow()
    brush.onPointerUp(release())
    await settle()

    expect(layerPixels('r', { x: 65, y: 50, w: 1, h: 1 })[3]).toBe(255)
  })
})

/**
 * The default ships the stabilizer off, so nothing above this line ever
 * turns it on. Ticket 04's grouping invariant is a causal filter's property
 * as much as an unfiltered path's, so it has to survive with the stabilizer
 * switched on too — this pins that directly, with the strength turned up
 * from the setting the rest of the suite never touches.
 */
describe("a move event's coalesced points, with the stabilizer switched on", () => {
  it('still lands the same pixels as the same points delivered one move at a time', async () => {
    const { editor } = openWith(raster('coalesced'), raster('separate'))
    editor.setTool('brush')
    useSelectionStore().brushes.paint.size = 40
    useSelectionStore().brushes.paint.stabilization = 0.6

    const bentPath = [
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 150 },
      { x: 90, y: 110 },
    ]

    editor.selectOnly('coalesced')
    const batched = useLayerBrush(container)
    batched.onPointerDown(press(bentPath[0].x, bentPath[0].y))
    batched.onPointerMove(coalescedMove(bentPath.slice(1)))
    batched.onPointerUp(release())
    await settle()

    editor.selectOnly('separate')
    const single = useLayerBrush(container)
    single.onPointerDown(press(bentPath[0].x, bentPath[0].y))
    for (const p of bentPath.slice(1)) single.onPointerMove(press(p.x, p.y))
    single.onPointerUp(release())
    await settle()

    const region = { x: 0, y: 0, w: 200, h: 200 }
    expect([...layerPixels('coalesced', region)]).toEqual([...layerPixels('separate', region)])
  })
})
