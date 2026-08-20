import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { isHidden, isLocked } from '@shared/page/tree'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Which layer a pixel operation acts on, and whether it may.
 *
 * One answer for filling, erasing and lifting rather than three. They differ in
 * what they do to the pixels and agree entirely on where those pixels are and
 * who is allowed near them, so the agreement is written once — three copies of
 * it would be three chances for a refusal to be forgotten.
 */
export function useRasterTarget() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const notices = useNoticeStore()

  /** The raster layer the cursor is standing on, if it is standing on one. */
  const target = computed<RasterLayerEntry | null>(() => {
    const id = editor.cursorId
    if (id === null) return null
    const entry = project.entryById(id)
    return entry?.kind === 'raster' ? entry : null
  })

  /**
   * Whether this layer is out of bounds, saying why when it is.
   *
   * Both refusals are about work whose result could not be seen: a locked layer
   * is one somebody protected, and a hidden one would take the change and show
   * nothing, which is indistinguishable from the tool being broken. Both are
   * inherited through folders, as locking already was for dragging.
   */
  function refuse(pageId: string, entry: RasterLayerEntry): boolean {
    const layers = project.pageById(pageId)?.page.layers ?? []
    if (isLocked(layers, entry.id)) {
      notices.say(`「${entry.name}」鎖定中，改不了`)
      return true
    }
    if (isHidden(layers, entry.id)) {
      notices.say(`「${entry.name}」是隱藏的，改不了`)
      return true
    }
    return false
  }

  return { target, refuse }
}
