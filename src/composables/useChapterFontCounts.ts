import { computed } from 'vue'
import { blocksOnSide } from '@shared/page/units'
import { useProjectStore } from '@/stores/projectStore'

/**
 * How many translations in the open chapter each family sets — the faces this
 * work already reaches for. Only families this machine has can be drawn, so a
 * list built from it shows none the catalogue lacks.
 */
export function useChapterFontCounts() {
  const project = useProjectStore()
  return computed(() => {
    const out = new Map<string, number>()
    for (const file of project.files) {
      if (file.badge !== 'ok') continue
      for (const block of blocksOnSide(file.page.layers, 'translation')) {
        const family = block.body.style.fontFamily
        if (family) out.set(family, (out.get(family) ?? 0) + 1)
      }
    }
    return out
  })
}
