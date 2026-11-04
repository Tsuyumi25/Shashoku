import type { LayerEffect } from '@shared/effects/types'
import { strokeOf } from '@shared/effects/stroke'
import type { TextLayerEntry } from '@shared/page/types'
import { shownCodeOf } from '@shared/page/units'
import { previewedStyle } from '@/composables/useFontPicker'
import { lettersOnly, withJoinedBands } from '@/lib/joinedStroke'
import { drawnLabel, type DrawnLabel } from '@/lib/labelRaster'
import { sourceLook } from '@/lib/sourceLook'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

export interface CanvasLabels {
  /** The effects the canvas draws an object with, which on the source side are the reference halo. */
  effectsOf(entry: TextLayerEntry): readonly LayerEffect[]
  labelOf(entry: TextLayerEntry): DrawnLabel
  /**
   * The object's bitmap with its band kept off the letters of `under`, or null
   * when it draws as it is. See `withJoinedBands`.
   */
  joinedOf(entry: TextLayerEntry, under: readonly TextLayerEntry[]): OffscreenCanvas | null
}

/**
 * Text objects typeset the way the canvas shows them.
 *
 * ⚠️ Which body is painted, and how, are the interface's questions rather than
 * the page's — the compositor answers both differently. It always draws the
 * translation, and it draws it in the style the object carries, because what it
 * builds is the page as delivered. A reference treatment for reading a source
 * against un-lettered artwork belongs on screen and nowhere else.
 *
 * Reads reactive state, so call these inside whatever is meant to follow it.
 */
export function useCanvasLabel(): CanvasLabels {
  const editor = useEditorStore()
  const project = useProjectStore()

  /**
   * ⚠️ Goes up to the page, because a chosen candidate is the translation's
   * answer rather than the block's. A block drawn from its own words alone would
   * keep showing what somebody typed after they picked something else.
   */
  function codeShown(entry: TextLayerEntry): string {
    const page = project.pageById(editor.currentPageId ?? '')?.page
    return page === undefined ? entry.body.lines.join('\n') : shownCodeOf(entry)
  }

  // ⚠️ The same treatment the frames are measured with, and it has to be: a
  // halo grows the bitmap, so a frame that counted one around text drawn
  // without it is a frame that does not sit on its own letters.
  function lookOf(entry: TextLayerEntry) {
    const style = previewedStyle(entry.body.style, editor.isReached(entry.id))
    return editor.textSide === 'source' ? sourceLook(style) : { style, effects: entry.effects }
  }

  function drawn(entry: TextLayerEntry, lettersAlone: boolean): DrawnLabel {
    const { style, effects } = lookOf(entry)
    const body = entry.body
    const used = lettersAlone ? lettersOnly(effects) : effects
    return drawnLabel(codeShown(entry), style, used, { x: body.x, y: body.y }, body.rotation)
  }

  /**
   * Keyed on the object's own bitmap, and good for as long as the bitmaps and
   * places of the objects under it are the ones it was made from — so a drag
   * redoes the object moving and the ones joined to it, and none of the rest.
   */
  const joinedCache = new WeakMap<object, { from: readonly unknown[]; canvas: OffscreenCanvas | null }>()

  return {
    effectsOf: (entry) => lookOf(entry).effects,
    labelOf: (entry) => drawn(entry, false),
    joinedOf: (entry, under) => {
      const position = strokeOf(lookOf(entry).effects)?.position
      if (!position) return null
      const own = drawn(entry, false)
      if (!own.sample) return null
      const others = under.map((other) => drawn(other, false))
      const from = [position, own.center.x, own.center.y, ...others.flatMap((o) => [o.sample, o.center.x, o.center.y])]
      const held = joinedCache.get(own.sample)
      if (held && held.from.length === from.length && held.from.every((v, i) => v === from[i])) return held.canvas
      const canvas = withJoinedBands(own, drawn(entry, true), position, others)
      joinedCache.set(own.sample, { from, canvas })
      return canvas
    },
  }
}
