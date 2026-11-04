import type { TextLayerEntry } from '@shared/page/types'
import { shownCodeOf } from '@shared/page/units'
import { previewedStyle } from '@/composables/useFontPicker'
import { drawnLabel, type DrawnLabel } from '@/lib/labelRaster'
import { sourceLook } from '@/lib/sourceLook'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A text object typeset the way the canvas shows it.
 *
 * ⚠️ Which body is painted, and how, are the interface's questions rather than
 * the page's — the compositor answers both differently. It always draws the
 * translation, and it draws it in the style the object carries, because what it
 * builds is the page as delivered. A reference treatment for reading a source
 * against un-lettered artwork belongs on screen and nowhere else.
 *
 * Reads reactive state, so call it inside whatever is meant to follow it.
 */
export function useCanvasLabel(): (entry: TextLayerEntry) => DrawnLabel {
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

  return (entry) => {
    const body = entry.body
    // ⚠️ The same treatment the frames are measured with, and it has to be: a
    // halo grows the bitmap, so a frame that counted one around text drawn
    // without it is a frame that does not sit on its own letters.
    const style = previewedStyle(body.style, editor.isReached(entry.id))
    const look = editor.textSide === 'source' ? sourceLook(style) : { style, effects: entry.effects }
    return drawnLabel(codeShown(entry), look.style, look.effects, { x: body.x, y: body.y }, body.rotation)
  }
}
