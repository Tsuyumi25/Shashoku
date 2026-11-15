<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <span class="min-w-0 truncate text-sm font-medium">{{ library.title }}</span>
      <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ library.cards.length }}</span>
      <span
        v-if="library.source.kind === 'workspace'"
        class="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground"
        :title="library.source.path"
      >
        {{ library.source.path }}
      </span>

      <ToggleGroupRoot
        type="single"
        class="seg ml-auto shrink-0"
        :model-value="library.view"
        @update:model-value="(v) => (v === 'list' || v === 'thumbnail') && (library.view = v)"
      >
        <ToggleGroupItem value="list" class="seg-item shelf-view-item" title="清單">
          <List :size="13" />
        </ToggleGroupItem>
        <ToggleGroupItem value="thumbnail" class="seg-item shelf-view-item" title="格狀">
          <LayoutGrid :size="13" />
        </ToggleGroupItem>
      </ToggleGroupRoot>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3" @click.self="library.select(null)">
      <p v-if="library.cards.length === 0" class="mx-auto mt-16 max-w-xs text-center text-sm text-muted-foreground">
        {{ emptyNote }}
      </p>
      <div
        v-else
        :class="library.view === 'thumbnail' ? 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2' : 'flex flex-col gap-0.5'"
      >
        <ContextMenuRoot v-for="card in library.cards" :key="card.path">
          <ContextMenuTrigger as-child>
            <LibraryProjectCard
              :card="card"
              :view="library.view"
              :selected="library.selected?.path === card.path"
              :open="card.path === project.folderPath"
              @pointerdown="library.select(card.path)"
              @dblclick="card.found && actions.open(card.path)"
            />
          </ContextMenuTrigger>
          <LibraryCardMenu :card="card" :favorite-id="favoriteId" />
        </ContextMenuRoot>
      </div>
    </div>

    <Notice />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ContextMenuRoot, ContextMenuTrigger, ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { LayoutGrid, List } from '@lucide/vue'
import LibraryCardMenu from '@/components/library/LibraryCardMenu.vue'
import LibraryProjectCard from '@/components/library/LibraryProjectCard.vue'
import Notice from '@/components/Notice.vue'
import { useLibraryActions } from '@/composables/useLibraryActions'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'

const library = useLibraryStore()
const project = useProjectStore()
const actions = useLibraryActions()

const favoriteId = computed(() => (library.source.kind === 'favorite' ? library.source.id : null))

const emptyNote = computed(() => {
  switch (library.source.kind) {
    case 'recent':
    case 'all':
      return '還沒有建立或打開過專案。按左上角「新增專案」，或把裝著原圖的資料夾拖進來。'
    case 'favorite':
      return '這個收藏夾是空的。在專案上按右鍵，從「收藏夾」勾進來，或把專案資料夾拖到左邊這一列。'
    case 'workspace':
      return library.scanning ? '掃描中…' : '這個工作區底下沒有專案。'
  }
  return ''
})
</script>

<style scoped>
.shelf-view-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  padding: 0;
}
</style>
