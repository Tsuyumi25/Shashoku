<template>
  <div class="flex h-full w-full flex-col">
    <div
      v-if="project.isOpen"
      class="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 select-none"
    >
      <span class="text-xs text-muted-foreground">
        已選 {{ exportSelection.selected.length }} / {{ project.files.length }} 頁
      </span>
      <!-- One control, because pressing it again is what "none" means. -->
      <button
        class="grid-action ml-auto flex items-center gap-1.5"
        @click="exportSelection.toggleAll()"
      >
        <span class="pick" :data-checked="String(exportSelection.allSelected)">
          <Check :size="11" :stroke-width="3" />
        </span>
        <span>全選</span>
      </button>
    </div>

    <div v-if="!project.isOpen" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        左邊的清單就是你的專案櫃。用「新增」把一個裝著原圖的資料夾建成專案,或用「加入資料夾」把已經做過的一批列進來。
      </p>
    </div>

    <div v-else-if="project.files.length === 0" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        還沒有頁面。左邊挑要用的圖,按「建立 N 頁」——那一步會把像素複製進專案,之後原圖搬走或刪掉都不影響。
      </p>
    </div>

    <!-- Dragging across the grid picks pages; it must never start highlighting page
         names instead. -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto p-2 select-none">
      <div
        class="grid items-start gap-2"
        :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }"
      >
        <PageThumb
          v-for="file in project.files"
          :key="file.pageId"
          :file="file"
          :selected="exportSelection.isSelected(file.pageId)"
          @pick="onPick(file.pageId, $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Check } from '@lucide/vue'
import PageThumb from '@/components/PageThumb.vue'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { useExportStore } from '@/stores/exportStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const preferences = usePreferencesStore()
const exportSelection = useExportStore()

// Nothing composites without the catalogue, and this view can be the first one
// a session ever reaches.
onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('font enumeration failed', err)
  })
})

function onPick(pageId: string, e: MouseEvent) {
  if (e.shiftKey) exportSelection.extendTo(pageId)
  else if (e.ctrlKey || e.metaKey) exportSelection.toggle(pageId)
  else exportSelection.only(pageId)
}
</script>

<style scoped>
.grid-action {
  cursor: pointer;
  height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.grid-action:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
