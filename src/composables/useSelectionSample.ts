import { computed, type ComputedRef } from 'vue'
import { escapeText } from '@shared/page/markup'
import type { TextLayerEntry } from '@shared/page/types'
import { blocksOnSide, shownLinesOf } from '@shared/page/units'
import type { AppearanceTarget } from '@/lib/appearance'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

export interface SelectionSample {
  /** The text objects a value or a look would be given to. */
  targets: ComputedRef<AppearanceTarget<TextLayerEntry>[]>
  /**
   * What every candidate is drawn on: the selection's first object — or, with
   * nothing selected, the chapter's first — cut to its first two lines of four,
   * enough for a leading or a scale to show without a row standing taller than
   * a hand.
   */
  source: ComputedRef<{ entry: TextLayerEntry; code: string } | null>
}

export function useSelectionSample(): SelectionSample {
  const editor = useEditorStore()
  const project = useProjectStore()

  const targets = computed(() =>
    editor
      .selectedNodes()
      .filter((t): t is AppearanceTarget<TextLayerEntry> => t.entry.kind === 'text'),
  )

  const source = computed(() => {
    const lead = targets.value[0]
    const pick = lead
      ? { pageId: lead.pageId, entry: lead.entry }
      : project.files
          .filter((f) => f.badge === 'ok')
          .flatMap((f) => blocksOnSide(f.page.layers, 'translation').map((entry) => ({ pageId: f.pageId, entry })))
          .find((p) => p.entry.body.style.fontFamily)
    if (!pick) return null
    const page = project.pageById(pick.pageId)?.page
    if (!page) return null
    const lines = shownLinesOf(page, pick.entry)
      .slice(0, 2)
      .map((line) => line.slice(0, 4))
      .filter(Boolean)
    return lines.length ? { entry: pick.entry, code: lines.map(escapeText).join('\n') } : null
  })

  return { targets, source }
}
