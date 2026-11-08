import { ref } from 'vue'

/**
 * What the left column shows: a shelf of saved materials, the chapter's own
 * text objects, or the fonts. Which shelf is open is asked for from the right
 * button's ring as often as from the column itself, so the answer lives here
 * rather than in either.
 */
export type ColumnView = 'materials' | 'objects' | 'font'

const shown = ref<ColumnView>('font')
/** The group the materials view has open; an id no longer saved reads as no group. */
const openGroupId = ref<string | null>(null)

export function useLeftColumn() {
  return {
    shown,
    openGroupId,
    show(view: ColumnView) {
      shown.value = view
    },
    openGroup(id: string) {
      openGroupId.value = id
      shown.value = 'materials'
    },
  }
}
