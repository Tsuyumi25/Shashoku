<template>
  <div class="flex min-h-0 flex-1 flex-col border-l border-border bg-card">
    <div v-if="!card" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[14rem] text-center text-sm text-muted-foreground">挑一個專案，這裡就講它的事。</p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-3">
      <p class="text-sm break-words">{{ card.name }}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {{ card.found ? `專案 · ${card.pageCount} 頁` : '找不到：這個位置已經沒有專案了' }}
      </p>

      <dl class="mt-3">
        <dt class="text-xs text-muted-foreground">位置</dt>
        <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
          {{ card.path }}
        </dd>
      </dl>

      <div class="mt-3 flex flex-col gap-1">
        <template v-if="card.found">
          <button class="info-btn" @click="actions.open(card.path)">
            <BookOpen :size="14" />
            <span>{{ card.path === project.folderPath ? '回到編輯器' : '開啟' }}</span>
          </button>
          <button class="info-btn" @click="actions.reveal(card.path)">
            <FolderSearch :size="14" />
            <span>在檔案管理員中顯示</span>
          </button>
        </template>
        <button v-else-if="favoriteId" class="info-btn" @click="library.relink(favoriteId, card)">
          <FolderSync :size="14" />
          <span>重新指定資料夾…</span>
        </button>
      </div>

      <template v-if="preferences.prefs.favorites.length > 0">
        <p class="mt-5 text-xs text-muted-foreground">收藏夾</p>
        <label
          v-for="favorite in preferences.prefs.favorites"
          :key="favorite.id"
          class="mt-1 flex cursor-default items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            :checked="library.inFavorite(favorite.id, card)"
            @change="library.toggleFavorite(favorite.id, card)"
          />
          <span class="min-w-0 truncate">{{ favorite.name }}</span>
        </label>
      </template>

      <LibraryCover v-if="card.found" class="mt-4" :cover="card.cover" natural />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, FolderSearch, FolderSync } from '@lucide/vue'
import LibraryCover from '@/components/library/LibraryCover.vue'
import { useLibraryActions } from '@/composables/useLibraryActions'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const library = useLibraryStore()
const preferences = usePreferencesStore()
const project = useProjectStore()
const actions = useLibraryActions()

const card = computed(() => library.selected)
const favoriteId = computed(() => (library.source.kind === 'favorite' ? library.source.id : null))
</script>

<style scoped>
.info-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  color: var(--muted-foreground);
}
.info-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
