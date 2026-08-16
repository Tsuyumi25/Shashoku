<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-3 select-none">
    <p
      v-if="library.entries.length === 0"
      class="px-2 py-8 text-center text-sm text-muted-foreground"
    >
      還沒有任何專案。左邊用「新增」把一個裝著原圖的資料夾建成專案，或用「開啟」把做過的列進來。
    </p>

    <template v-for="entry in library.entries" :key="entry.path">
      <template v-if="entry.kind === 'series'">
        <p class="mt-2 mb-1 px-1 text-sm font-medium first:mt-0">
          {{ entry.name }}
          <span class="ml-1 text-xs text-muted-foreground">{{ entry.projects.length }}</span>
        </p>
        <div :class="gridClass">
          <div
            v-for="child in entry.projects"
            :key="child.path"
            class="rounded-md"
            :class="picked === child.path && 'ring-2 ring-ring'"
          >
            <ProjectEntryButton
              :project="child"
              view="thumbnail"
              :open="child.path === project.folderPath"
              @pick="picked = child.path"
              @dblclick="openInto(child.path)"
            />
          </div>
        </div>
      </template>
    </template>

    <div :class="gridClass" class="mt-2">
      <template v-for="entry in library.entries" :key="entry.path">
        <div
          v-if="entry.kind !== 'series'"
          class="rounded-md"
          :class="picked === entry.path && 'ring-2 ring-ring'"
        >
          <ProjectEntryButton
            :project="entry"
            view="thumbnail"
            :open="entry.path === project.folderPath"
            @pick="picked = entry.path"
            @dblclick="openInto(entry.path)"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ProjectEntryButton from '@/components/ProjectEntryButton.vue'
import { useOpenProject } from '@/composables/useOpenProject'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const library = useLibraryStore()
const project = useProjectStore()
const ui = useUiStore()
const { openPath } = useOpenProject()

/** Single click marks, double click commits — the file-manager contract. */
const picked = ref<string | null>(null)

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-3'

onMounted(() => {
  void library.refresh()
})

async function openInto(path: string) {
  if (path !== project.folderPath) {
    const opened = await openPath(path)
    if (!opened) return
  }
  ui.setView('editor')
}
</script>
