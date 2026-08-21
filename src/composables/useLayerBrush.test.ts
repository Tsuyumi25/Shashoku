import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
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

/**
 * The real engine, not a stand-in. What a stroke is for is the pixels it leaves
 * in the tiles, and the frame those pixels move — both of which only the addon
 * can answer.
 */
const engine = createRequire(import.meta.url)('@shashoku/engine') as Window['engine']

const PAGE_ID = 'source-260809-1200'
const PAGE = { page: PAGE_ID, w: 400, h: 300 }

/**
 * Enough of a canvas for the renderer's own mirror of a layer to exist. Nothing
 * here is asserted on: every test reads the engine, which is where the pixels
 * that matter live.
 */
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: () => {},
      putImageData: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
      }),
    }
  }
  convertToBlob() {
    return Promise.resolve(new Blob([new Uint8Array([1])]))
  }
}

class FakeImageData {
  data: Uint8ClampedArray
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
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

  it('shows the stroke before the button comes up', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })

    brush.onPointerMove(press(80, 50))

    const shown = useRasterStore().liveLayer('r')
    expect(shown).not.toBeNull()
    expect(shown!.frame.w).toBeGreaterThan(0)
  })

  /** One crossing per event, which is the whole of the cost being spent. */
  it('asks the engine once per pointer event, and does not save them up', async () => {
    const { brush } = open(framed)
    await pressAndSettle(brush, { x: 50, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    brush.onPointerMove(press(60, 50))
    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(80, 50))

    expect(preview).toHaveBeenCalledTimes(3)
  })

  /**
   * The one event that costs two. A frame that moved is answered over the whole
   * of itself, and that answer has to carry the whole stroke rather than the
   * segment the first question was about — so the region the engine names is
   * asked about again. Said out loud because the standing rule is one crossing
   * an event, and this is where it does not hold.
   */
  it('costs a second crossing on the event that moves the frame', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    // Far enough to leave the room the first move took with it.
    brush.onPointerMove(press(1200, 900))

    expect(preview).toHaveBeenCalledTimes(2)
    const moved = preview.mock.results[0].value as EngineLayerPixels
    // The first answer is the frame alone — no pixels, because the ones wanted
    // next are the whole frame's and this segment's mask cannot paint them.
    expect(moved.rgba.length).toBe(0)
    // The second asks over exactly that frame.
    expect(preview.mock.calls[1][2]).toEqual(moved.frame)
  })

  /**
   * And the events either side of it cost one. Room to grow into is what makes
   * the expensive event rare rather than every event — a frame moving on each
   * one is a rebuild on each one, which is the most expensive thing a stroke
   * can ask for.
   */
  it('takes room with it, so the events after a move are cheap again', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    brush.onPointerMove(press(70, 55))
    brush.onPointerMove(press(90, 60))
    brush.onPointerMove(press(110, 65))

    expect(preview).toHaveBeenCalledTimes(3)
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

  /** What the hand last saw is what the release leaves, to the byte. */
  it('agrees with the committed layer once the button comes up', async () => {
    const { editor, brush } = open()
    editor.foreground = '#3366ff'
    await pressAndSettle(brush, { x: 50, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    brush.onPointerMove(press(70, 50))
    const last = preview.mock.results[preview.mock.results.length - 1].value as EngineLayerPixels

    brush.onPointerUp()
    await settle()

    // Paint in it, so the two agreeing is not two blanks agreeing.
    expect(last.rgba.some((byte) => byte !== 0)).toBe(true)
    expect([...layerPixels('r', last.changed)]).toEqual([...last.rgba])
  })

  it('shows the eraser punching through, not painting over', async () => {
    const { editor, brush } = open()
    editor.foreground = '#ffffff'
    await stroke(brush, { x: 50, y: 50 }, { x: 90, y: 50 })

    editor.setTool('eraser')
    const eraser = useLayerBrush(container)
    await pressAndSettle(eraser, { x: 70, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewErase')
    eraser.onPointerMove(press(72, 50))

    expect(preview).toHaveBeenCalled()
    const shown = preview.mock.results[0].value as EngineLayerPixels
    const at = shown.changed
    const middle = ((70 - at.y) * at.w + (71 - at.x)) * 4
    expect(shown.rgba[middle + 3]).toBe(0)
  })

  /**
   * The frame a preview stands on has to be the one the release settles for.
   * The renderer's copy of a layer is rebuilt whenever its frame changes, so a
   * preview standing on a frame the release then disagrees with has that copy
   * thrown away and only the tiles the write touched put back — the rest of the
   * layer vanishing under the hand that drew it.
   */
  it('never moves the frame of a layer whose frame already holds the stroke', async () => {
    const { brush } = open(framed)
    await pressAndSettle(brush, { x: 50, y: 50 })
    const stood = { ...useRasterStore().liveLayer('r')!.frame }

    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(90, 62))
    expect(useRasterStore().liveLayer('r')!.frame).toEqual(stood)

    brush.onPointerUp()
    await settle()

    expect(useRasterStore().liveLayer('r')!.frame).toEqual(stood)
  })

  /**
   * Taking pixels out never moves a frame, so neither may showing it about to
   * happen — even reaching past the edge, where there is nothing to take.
   */
  it('never moves the frame for an eraser, edge or not', async () => {
    const { editor, brush } = open(framed)
    await stroke(brush, { x: 50, y: 50 }, { x: 90, y: 50 })
    const stood = { ...useRasterStore().liveLayer('r')!.frame }

    editor.setTool('eraser')
    const eraser = useLayerBrush(container)
    await pressAndSettle(eraser, { x: PAGE.w - 2, y: PAGE.h - 2 })
    eraser.onPointerMove(press(PAGE.w + 40, PAGE.h + 40))

    expect(useRasterStore().liveLayer('r')!.frame).toEqual(stood)
  })

  /**
   * On a layer the stroke does grow, the frame the previews stood on is wider
   * than the one the release settles for — and that is safe only because a
   * release that moved its own bounds hands the whole frame back, so the
   * rebuild it causes is fed everything rather than a few tiles.
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
   * A frame that moves takes the whole of itself back, and the whole of it has
   * to hold the whole stroke. Everything drawn earlier is uncommitted — it
   * lives nowhere but on the picture the move is about to replace — so an
   * answer worked out from one segment's coverage would rub it out.
   */
  it('keeps what the stroke drew earlier when the frame has to move', async () => {
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    brush.onPointerMove(press(120, 50))
    brush.onPointerMove(press(190, 50))

    const last = preview.mock.results[preview.mock.results.length - 1].value as EngineLayerPixels
    const at = last.changed
    const first = ((50 - at.y) * at.w + (50 - at.x)) * 4
    expect(last.rgba[first + 3]).toBe(255)
  })

  /**
   * Everything that reads a canvas back to build itself hangs off this. A
   * stroke shown at one preview per pointer event would have those readbacks
   * run per event too, and reading a whole canvas back is more than a frame's
   * worth of time on a layer of any size.
   */
  it('says nothing was written until the stroke commits', async () => {
    const raster = useRasterStore()
    const { brush } = open()
    await pressAndSettle(brush, { x: 50, y: 50 })
    const written = raster.committed

    brush.onPointerMove(press(70, 50))
    brush.onPointerMove(press(90, 50))
    brush.onPointerMove(press(110, 50))

    // Drawn on three times over, and written to none.
    expect(raster.revision).toBeGreaterThan(0)
    expect(raster.committed).toBe(written)

    brush.onPointerUp()
    await settle()

    expect(raster.committed).toBeGreaterThan(written)
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
   * A stroke the selection cuts away entirely commits nothing, so it must not
   * leave the layer's frame grown by what it showed on the way.
   */
  it('shows nothing, and grows nothing, outside the selection', async () => {
    const { brush } = open()
    selectRect({ x: 200, y: 200, w: 20, h: 20 })
    const preview = vi.spyOn(engine, 'rasterPreviewFill')

    await pressAndSettle(brush, { x: 50, y: 50 })
    brush.onPointerMove(press(70, 50))

    // Asked, and told there is nothing there. Emptiness is the engine's answer
    // rather than a guess made before asking, so there is one place that
    // decides it and the frame cannot be moved by a guess.
    expect(preview).toHaveBeenCalled()
    expect(preview.mock.results.every((call) => call.value === null)).toBe(true)
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
