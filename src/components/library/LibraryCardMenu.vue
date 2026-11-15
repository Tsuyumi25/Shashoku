<template>
  <ContextMenuPortal>
    <ContextMenuContent class="dropdown-content" :collision-padding="8">
      <template v-if="card.found">
        <ContextMenuItem class="dropdown-item" @select="actions.open(card.path)">
          <BookOpen :size="14" />
          <span>{{ card.path === project.folderPath ? '回到編輯器' : '打開' }}</span>
        </ContextMenuItem>
        <ContextMenuItem class="dropdown-item" @select="actions.reveal(card.path)">
          <FolderSearch :size="14" />
          <span>在檔案管理員中顯示</span>
        </ContextMenuItem>
      </template>
      <ContextMenuItem
        v-else-if="favoriteId"
        class="dropdown-item"
        @select="library.relink(favoriteId, card)"
      >
        <FolderSync :size="14" />
        <span>重新指定資料夾…</span>
      </ContextMenuItem>

      <ContextMenuSeparator class="dropdown-separator" />

      <ContextMenuSub>
        <ContextMenuSubTrigger class="dropdown-item">
          <Star :size="14" />
          <span class="flex-1">收藏夾</span>
          <ChevronRight :size="13" />
        </ContextMenuSubTrigger>
        <ContextMenuPortal>
          <ContextMenuSubContent class="dropdown-content" :collision-padding="8">
            <ContextMenuCheckboxItem
              v-for="favorite in preferences.prefs.favorites"
              :key="favorite.id"
              class="dropdown-item"
              :model-value="library.inFavorite(favorite.id, card)"
              @select.prevent="library.toggleFavorite(favorite.id, card)"
            >
              <span class="flex w-3.5 justify-center">
                <ContextMenuItemIndicator><Check :size="13" /></ContextMenuItemIndicator>
              </span>
              <span>{{ favorite.name }}</span>
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator v-if="preferences.prefs.favorites.length > 0" class="dropdown-separator" />
            <ContextMenuItem class="dropdown-item" @select="addToNew">
              <Plus :size="14" />
              <span>新收藏夾</span>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuPortal>
      </ContextMenuSub>

      <template v-if="favoriteId">
        <ContextMenuSeparator class="dropdown-separator" />
        <ContextMenuItem class="dropdown-item" @select="library.toggleFavorite(favoriteId, card)">
          <StarOff :size="14" />
          <span>從這個收藏夾移除</span>
        </ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenuPortal>
</template>

<script setup lang="ts">
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemIndicator,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from 'reka-ui'
import { BookOpen, Check, ChevronRight, FolderSearch, FolderSync, Plus, Star, StarOff } from '@lucide/vue'
import type { ProjectCard } from '@shared/project/workspace'
import { useLibraryActions } from '@/composables/useLibraryActions'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const props = defineProps<{
  card: ProjectCard
  /** The 收藏夾 the card is being shown in, if any. */
  favoriteId: string | null
}>()

const library = useLibraryStore()
const preferences = usePreferencesStore()
const project = useProjectStore()
const actions = useLibraryActions()

function addToNew() {
  library.toggleFavorite(library.createFavorite(), props.card)
}
</script>
