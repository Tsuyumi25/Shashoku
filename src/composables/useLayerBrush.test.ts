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

/** A container whose box starts at the origin, so a client point is a page point. */
const container = ref({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: PAGE.w, height: PAGE.h }),
  setPointerCapture: () => {},
} as unknown as HTMLElement)

function press(x: number, y: number): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: container.value,
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
  brush.onPointerUp()
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
    brush.onPointerUp()
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

  it('is one step however many segments it was drawn from', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    editor.setTool('brush')
    const brush = useLayerBrush(container)

    brush.onPointerDown(press(50, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(90, 50))
    brush.onPointerMove(press(110, 50))
    brush.onPointerUp()
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

    brush.onPointerUp()
    await settle()

    const written = layerPixels('r', { x: 60, y: 68, w: 1, h: 1 })
    expect(written[3]).toBe(rim)
    expect([...written.slice(0, 3)]).toEqual([0x33, 0x66, 0xff])
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

    brush.onPointerUp()
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
    brush.onPointerUp()
    brush.onPointerDown(press(120, 50))
    brush.onPointerMove(press(140, 50))
    brush.onPointerUp()
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
    brush.onPointerUp()

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

    brush.onPointerUp()
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
    brush.onPointerUp()
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
    brush.onPointerUp()
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
