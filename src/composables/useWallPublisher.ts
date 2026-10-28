import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { WallScene } from '@shared/wall/scene'
import { wallSceneOf } from '@/lib/wallScene'
import { useProjectStore } from '@/stores/projectStore'
import { useEditorStore } from '@/stores/editorStore'
import { brushMeaning, revealPiece, selectPieces } from '@/lib/wallActions'

/**
 * The editor's half of the wall: hands the wall window the chapter while it is
 * open, and turns to a piece when the wall points at one.
 *
 * Gathered only while the wall is there. The words and looks are copied out as
 * plain data — a reactive proxy cannot cross to another window — and sent a
 * moment after the last change rather than on every keystroke.
 */
export function useWallPublisher(): void {
  const project = useProjectStore()
  const editor = useEditorStore()

  const open = ref(false)
  window.api.onWallState((now) => {
    open.value = now
  })

  const scene = computed<WallScene | null>(() =>
    open.value ? wallSceneOf(project.files, project.header.tags, editor.currentPageId) : null,
  )

  const send = () => {
    if (scene.value) window.api.wallPublish(JSON.parse(JSON.stringify(scene.value)))
  }
  const sendSoon = useDebounceFn(send, 200)

  watch(scene, sendSoon)

  // Apart from the scene and at once: a selection changes on every click, and
  // nothing about it needs the chapter drawn again.
  const sendSelection = () => {
    if (open.value) window.api.wallPublishSelection([...editor.selectedIds])
  }
  watch(() => editor.selectedIds, sendSelection)

  window.api.onWallSceneWanted(() => {
    send()
    sendSelection()
  })

  window.api.onWallReveal((pageId, id) => revealPiece(pageId, id))
  window.api.onWallSelect((ids) => selectPieces(ids))
  window.api.onWallBrush((tags) => brushMeaning(tags))
}
