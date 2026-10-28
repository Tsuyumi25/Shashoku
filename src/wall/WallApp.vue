<template>
  <div class="flex h-full min-h-0">
    <div class="w-48 shrink-0 border-r border-border bg-card">
      <WallControls />
    </div>
    <div class="min-w-0 flex-1">
      <WallView
        :scene="scene"
        :selected="selected"
        @reveal="reveal"
        @select="select"
        @brush="brush"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue'
import { useDark } from '@vueuse/core'
import type { WallScene } from '@shared/wall/scene'
import WallControls from '@/components/wall/WallControls.vue'
import WallView from '@/components/wall/WallView.vue'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The wall's own window. It knows the font folders and the theme, which both
 * windows read from the same places, and everything else it is handed.
 */
useDark({ initialValue: 'light' })

const scene = shallowRef<WallScene>({ entries: [], registry: [], currentPageId: null })
window.api.onWallScene((next) => {
  scene.value = next
})
const selected = shallowRef<ReadonlySet<string>>(new Set())
window.api.onWallSelection((ids) => {
  selected.value = new Set(ids)
})
window.api.wallWantScene()

function reveal(pageId: string, id: string) {
  window.api.wallReveal(pageId, id)
}

function select(ids: string[]) {
  window.api.wallSelect(ids)
}

function brush(tags: readonly string[]) {
  window.api.wallBrush([...tags])
}

loadFontCatalog(usePreferencesStore().prefs.fontFolders).catch((err: unknown) => {
  console.error('font enumeration failed', err)
})
</script>
