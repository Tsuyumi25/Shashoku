import { computed, type ComputedRef, type Ref } from 'vue'
import type { TextLayerEntry } from '@shared/page/types'
import { sameTagSet, tagsInRegistryOrder } from '@shared/tags/set'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/** What the selection means: nothing selected, one tag set they all share, or more than one. */
export type TagState = { kind: 'none' } | { kind: 'many' } | { kind: 'one'; value: string[] }

/**
 * Read one level up, from the translations the selected blocks belong to. A
 * sound set in two blocks means one thing, so two blocks of it agreeing is not
 * two votes for that meaning — it is the same fact seen twice.
 */
export function useSelectionTags(
  targets: Ref<readonly AppearanceTarget<TextLayerEntry>[]>,
): ComputedRef<TagState> {
  const project = useProjectStore()
  const editor = useEditorStore()
  return computed<TagState>(() => {
    const first = targets.value[0]
    if (!first) return { kind: 'none' }
    const tagsOf = (id: string) => project.placeOf(editor.currentPageId ?? '', id)?.unit.tags ?? []
    const head = tagsOf(first.entry.id)
    for (const { entry } of targets.value) {
      if (!sameTagSet(tagsOf(entry.id), head)) return { kind: 'many' }
    }
    return { kind: 'one', value: tagsInRegistryOrder(head, project.header.tags) }
  })
}
