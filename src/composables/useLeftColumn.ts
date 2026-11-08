import { ref } from 'vue'

/**
 * What the left column shows: the chapter's own text objects as materials, or
 * the fonts. Which of them is open is asked for from the canvas as often as
 * from the column itself, so the answer lives here rather than in either.
 */
export type ColumnView = 'materials' | 'font'

const shown = ref<ColumnView>('font')

export function useLeftColumn() {
  return {
    shown,
    show(view: ColumnView) {
      shown.value = view
    },
  }
}
