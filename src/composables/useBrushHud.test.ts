import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBrushHud } from './useBrushHud'
import { useSelectionStore } from '@/stores/selectionStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useBrushHud', () => {
  it('writes the brush as the drag goes rather than at the end', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    selection.brushes.paint.size = 40

    hud.begin('paint', 100, 100)
    hud.trackTo(220, 100)
    expect(selection.brushes.paint.size).toBe(Math.round(40 * Math.E))
  })

  it('measures from where the drag began, so coming back comes back', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    selection.brushes.paint.size = 40
    selection.brushes.paint.hardness = 0.8

    hud.begin('paint', 100, 100)
    hud.trackTo(220, 140)
    hud.trackTo(100, 100)
    expect(selection.brushes.paint.size).toBe(40)
    expect(selection.brushes.paint.hardness).toBe(0.8)
  })

  it('keeps what the drag reached when it is let go', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    selection.brushes.paint.size = 40

    hud.begin('paint', 100, 100)
    hud.trackTo(220, 100)
    hud.commit()
    expect(hud.gesture.value).toBeNull()
    expect(selection.brushes.paint.size).toBe(Math.round(40 * Math.E))
  })

  it('puts back what it started from when the drag is called off', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    selection.brushes.paint.size = 40
    selection.brushes.paint.hardness = 0.8

    hud.begin('paint', 100, 100)
    hud.trackTo(220, 300)
    hud.cancel()
    expect(hud.gesture.value).toBeNull()
    expect(selection.brushes.paint.size).toBe(40)
    expect(selection.brushes.paint.hardness).toBe(0.8)
  })

  it('leaves the brush of the other direction alone', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    const erasing = selection.brushes.erase.size

    hud.begin('paint', 100, 100)
    hud.trackTo(220, 160)
    expect(selection.brushes.erase.size).toBe(erasing)
  })

  it('does nothing without a drag to track', () => {
    const selection = useSelectionStore()
    const hud = useBrushHud()
    const before = selection.brushes.paint.size

    hud.trackTo(999, 999)
    hud.cancel()
    expect(selection.brushes.paint.size).toBe(before)
  })
})
