import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { NO_PLACEMENT, type LayerPlacement } from '@/lib/layerTransform'
import type { Rect } from '@/lib/selection/rect'
import { useGroupTransform, type GroupPlacement } from './useGroupTransform'

const FRAMES: Record<string, Rect> = {
  a: { x: 0, y: 0, w: 10, h: 10 },
  b: { x: 20, y: 0, w: 10, h: 10 },
}

function setup() {
  let held = new Map<string, LayerPlacement>()
  const placement: GroupPlacement = {
    placementOf: (id) => held.get(id) ?? NO_PLACEMENT,
    hold: (places) => {
      held = new Map([...held, ...places])
    },
    take: (ids) => new Map(ids.map((id) => [id, held.get(id) ?? NO_PLACEMENT])),
    settle: vi.fn(async () => []),
    release: vi.fn((taken: ReadonlyMap<string, LayerPlacement>) => {
      for (const id of taken.keys()) held.delete(id)
    }),
  }
  const group = useGroupTransform({
    pageId: () => 'p',
    ids: () => ['a', 'b'],
    codeOf: () => null,
    rasterFrame: (id) => FRAMES[id] ?? null,
    placement,
  })
  return { group, placement, placeOf: (id: string) => held.get(id)! }
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('raster layers in a multiple selection', () => {
  it('stands in one box with the rest of the set', () => {
    expect(setup().group.box.value).toEqual({ centerX: 15, centerY: 5, width: 30, height: 10 })
  })

  it('stretches each layer along the box and carries its middle with the side', () => {
    const { group, placeOf } = setup()
    group.begin({ x: 0, y: 0.5 })
    group.scaleAxesTo({ x: 2, y: 1 })
    const b = placeOf('b')
    close(b.a, 2)
    close(b.d, 1)
    close(b.b, 0)
    close(b.c, 0)
    // Its middle was 25 from the pinned left side and is now 50.
    close(b.dx, 25)
    close(b.dy, 0)
    close(placeOf('a').dx, 5)
  })

  it('turns each layer about the pivot as well as in place', () => {
    const { group, placeOf } = setup()
    group.begin({ x: 0.5, y: 0.5 })
    group.rotateTo(Math.PI / 2)
    const a = placeOf('a')
    close(a.a, 0)
    close(a.b, 1)
    close(a.c, -1)
    // Its middle (5, 5) goes round (15, 5) to (15, -5).
    close(a.dx, 10)
    close(a.dy, -10)
  })

  /** A layer lying across the box's axes cannot be stretched without shearing it, and pixels can hold that. */
  it('shears a layer when the box has been turned and a side is pulled', () => {
    const { group, placeOf } = setup()
    group.begin({ x: 0.5, y: 0.5 })
    group.rotateTo(Math.PI / 4)
    void group.end()
    group.begin({ x: 0, y: 0.5 })
    group.scaleAxesTo({ x: 2, y: 1 })
    const b = placeOf('b')
    close(b.b, b.c)
    expect(b.b).not.toBeCloseTo(0)
  })

  it('resamples and lets go of every layer it carried when the gesture ends', async () => {
    const { group, placement } = setup()
    group.begin({ x: 0.5, y: 0.5 })
    group.scaleTo(1.5)
    await group.end()
    const taken = vi.mocked(placement.settle).mock.calls[0]![1]
    expect([...taken.keys()]).toEqual(['a', 'b'])
    expect(placement.release).toHaveBeenCalledWith(taken)
  })
})
