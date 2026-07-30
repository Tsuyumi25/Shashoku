import { maskBrushModeOf, useEditorStore, type CanvasTool } from '@/stores/editorStore'
import { useSelectionStore } from '@/stores/selectionStore'

/**
 * Picking a tool, with what that tool needs in order to be any use.
 *
 * Held in one place because a tool can be reached three ways — the rail, its
 * key, and whatever asks next — and a requirement written out once per entry
 * point is a requirement that will eventually differ between them.
 */
export function useToolChoice() {
  const editor = useEditorStore()
  const selection = useSelectionStore()

  function chooseTool(tool: CanvasTool): void {
    editor.setTool(tool)
    // These draw the mask and the mask is only on screen in Quick Mask, so
    // asking for one of them is asking for the mode it needs. Turning that mode
    // back off with one of them up is what greys it out again.
    if (maskBrushModeOf(tool) !== null && !selection.quickMask) selection.toggleQuickMask()
  }

  return { chooseTool }
}
