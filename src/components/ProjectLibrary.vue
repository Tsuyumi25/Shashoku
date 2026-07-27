<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-border p-1">
      <button class="lib-entry" title="把這個含有原圖的資料夾建成專案" @click="onCreate">
        <FilePlus :size="13" />
        <span>新增</span>
      </button>
      <button class="lib-entry" title="開啟一個既有的專案" @click="onOpen">
        <FolderOpen :size="13" />
        <span>開啟</span>
      </button>
      <button class="lib-entry" title="把一個已經放著專案的資料夾列進清單" @click="onAddFolder">
        <FolderSearch :size="13" />
        <span>加入</span>
      </button>

      <ToggleGroupRoot
        type="single"
        class="seg lib-view ml-auto shrink-0"
        :model-value="library.view"
        @update:model-value="onView"
      >
        <ToggleGroupItem value="list" class="seg-item lib-view-item" title="清單">
          <List :size="13" />
        </ToggleGroupItem>
        <ToggleGroupItem value="thumbnail" class="seg-item lib-view-item" title="縮圖">
          <LayoutGrid :size="13" />
        </ToggleGroupItem>
      </ToggleGroupRoot>
    </div>

    <p v-if="lastError" class="shrink-0 px-2 py-1 text-xs text-destructive">{{ lastError }}</p>

    <!--
      One grid for the whole list, not one per entry: a grid holding a single
      item has no columns to fill. Series take a row of their own by spanning
      it, which is also what keeps their pages from flowing on into whatever
      comes after them.
    -->
    <div
      class="min-h-0 flex-1 overflow-y-auto p-1"
      :class="library.view === 'thumbnail' ? gridClass : ''"
    >
      <p
        v-if="library.entries.length === 0"
        class="col-span-full px-2 py-3 text-center text-xs text-muted-foreground"
      >
        還沒有任何專案
      </p>

      <template v-for="entry in library.entries" :key="entry.path">
        <template v-if="entry.kind === 'series'">
          <button class="lib-series col-span-full" @click="library.toggleExpanded(entry.path)">
            <ChevronRight
              :size="13"
              class="shrink-0 transition-transform"
              :class="{ 'rotate-90': library.isExpanded(entry.path) }"
            />
            <span class="truncate">{{ entry.name }}</span>
            <span class="ml-auto shrink-0 text-xs text-muted-foreground">
              {{ entry.projects.length }}
            </span>
          </button>
          <div
            v-if="library.isExpanded(entry.path)"
            class="col-span-full pl-4"
            :class="library.view === 'thumbnail' ? gridClass : ''"
          >
            <ProjectEntryButton
              v-for="child in entry.projects"
              :key="child.path"
              :project="child"
              :view="library.view"
              :open="child.path === project.folderPath"
              @pick="onPick(child.path)"
            />
          </div>
        </template>

        <ProjectEntryButton
          v-else
          :project="entry"
          :view="library.view"
          :open="entry.path === project.folderPath"
          @pick="onPick(entry.path)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { ChevronRight, FilePlus, FolderOpen, FolderSearch, LayoutGrid, List } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import ProjectEntryButton from '@/components/ProjectEntryButton.vue'
import { useOpenProject } from '@/composables/useOpenProject'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'

const library = useLibraryStore()
const project = useProjectStore()
const { lastError, createHere, openPicked, openPath } = useOpenProject()

// Spacing belongs to the grid, not to the items. Margins do not collapse
// between grid items, so they would double up between neighbours and stack on
// top of the container's own padding at the edges — one gap says it once.
const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] items-start gap-2'

onMounted(() => {
  void library.refresh()
})

async function onCreate() {
  await createHere()
}

async function onOpen() {
  await openPicked()
}

async function onAddFolder() {
  await library.addScanPoint()
}

async function onPick(path: string) {
  if (path === project.folderPath) return
  await openPath(path)
}

// A single-value toggle group can also clear itself, and there is no such
// thing as showing the library in no view at all.
function onView(v: unknown) {
  if (v === 'list' || v === 'thumbnail') library.view = v
}
</script>

<style scoped>
.lib-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 0;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.lib-entry:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.lib-series {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  text-align: left;
}
.lib-series:hover {
  background: var(--secondary);
}
.lib-view {
  width: 3.25rem;
}
.lib-view-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
</style>
