import type { LayerEffect } from '@shared/effects/types'
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

  return {
    effectsOf: (entry) => lookOf(entry).effects,
    labelOf: (entry) => drawn(entry, false),
    joinedOf: (entry, under) =>
      withJoinedBands(
        drawn(entry, false),
        drawn(entry, true),
        under.map((other) => drawn(other, true)),
      ),
  }
}
