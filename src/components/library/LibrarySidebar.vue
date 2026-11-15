<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-border p-1">
      <button
        class="lib-entry"
        title="從一個裝著原圖的資料夾建立專案；也可以直接把資料夾拖進書庫"
        @click="ui.openNewProject()"
      >
        <SquarePlus :size="13" />
        <span>新增專案</span>
      </button>
      <button class="lib-entry ml-auto" title="重新掃描" :disabled="library.scanning" @click="library.refresh()">
        <RefreshCw :size="13" :class="library.scanning && 'animate-spin'" />
      </button>
    </div>

    <div ref="rows" class="min-h-0 flex-1 overflow-y-auto p-1" @keydown="onRowKeydown">
      <div
        v-for="row in FIXED"
        :key="row.kind"
        class="lib-row"
        data-lib-row
        tabindex="0"
        :class="{ 'lib-row-on': library.isShowing({ kind: row.kind }) }"
        @click="library.show({ kind: row.kind })"
        @keydown.enter="library.show({ kind: row.kind })"
      >
        <component :is="row.icon" :size="15" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
        <span class="lib-count">{{ preferences.prefs.recentProjects.length }}</span>
      </div>

      <div class="lib-section">
        <span>收藏夾</span>
        <button class="lib-add" title="新增收藏夾" @click="startNewFavorite">
          <Plus :size="13" />
        </button>
      </div>
      <ContextMenuRoot v-for="favorite in preferences.prefs.favorites" :key="favorite.id">
        <ContextMenuTrigger as-child>
          <div
            class="lib-row"
            data-lib-row
            tabindex="0"
            :class="{ 'lib-row-on': library.isShowing({ kind: 'favorite', id: favorite.id }) }"
            title="把專案資料夾拖到這裡就會收進來；不是專案的資料夾會先建立專案"
            @click="library.show({ kind: 'favorite', id: favorite.id })"
            @keydown.enter="editing !== favorite.id && library.show({ kind: 'favorite', id: favorite.id })"
            @dragover="drop.onDragOver"
            @drop="drop.onDropInto(favorite.id)($event)"
          >
            <Star :size="15" class="shrink-0 text-muted-foreground" />
            <input
              v-if="editing === favorite.id"
              ref="nameInput"
              v-model="draft"
              class="min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm outline-none"
              spellcheck="false"
              @click.stop
              @keydown.enter.stop="commitName"
              @keydown.esc.stop="editing = null"
              @blur="commitName"
            />
            <span v-else class="min-w-0 flex-1 truncate">{{ favorite.name }}</span>
            <span class="lib-count">{{ library.cardsOf({ kind: 'favorite', id: favorite.id }).length }}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent class="dropdown-content" :collision-padding="8">
            <ContextMenuItem class="dropdown-item" @select="startRename(favorite.id, favorite.name)">
              <Pencil :size="14" />
              <span>重新命名</span>
            </ContextMenuItem>
            <ContextMenuSeparator class="dropdown-separator" />
            <ContextMenuItem class="dropdown-item" @select="library.deleteFavorite(favorite.id)">
              <Trash2 :size="14" />
              <span>刪除收藏夾</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>

      <div class="lib-section">
        <span>工作區</span>
        <button class="lib-add" title="加入工作區：Shashoku 會掃描這個資料夾底下的所有專案" @click="library.addWorkspace()">
          <Plus :size="13" />
        </button>
      </div>
      <p v-if="preferences.prefs.workspaces.length === 0" class="px-2 py-2 text-xs text-muted-foreground">
        把你存放專案的資料夾加進來，底下所有的專案都會列在這裡。
      </p>
      <ContextMenuRoot v-for="path in preferences.prefs.workspaces" :key="path">
        <ContextMenuTrigger as-child>
          <div
            class="lib-row"
            data-lib-row
            tabindex="0"
            :class="{ 'lib-row-on': library.isShowing({ kind: 'workspace', path }) }"
            :title="path"
            @click="library.show({ kind: 'workspace', path })"
            @keydown.enter="library.show({ kind: 'workspace', path })"
          >
            <FolderTree :size="15" class="shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{{ folderName(path) }}</span>
            <span class="lib-count">{{ library.cardsOf({ kind: 'workspace', path }).length }}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent class="dropdown-content" :collision-padding="8">
            <ContextMenuItem class="dropdown-item" @select="actions.reveal(path)">
              <FolderSearch :size="14" />
              <span>在檔案管理員中顯示</span>
            </ContextMenuItem>
            <ContextMenuSeparator class="dropdown-separator" />
            <ContextMenuItem class="dropdown-item" @select="library.removeWorkspace(path)">
              <FolderX :size="14" />
              <span>移除工作區</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, type Component } from 'vue'
import {
  FolderSearch,
  FolderTree,
  FolderX,
  History,
  LibraryBig,
  Pencil,
  Plus,
  RefreshCw,
  SquarePlus,
  Star,
  Trash2,
} from '@lucide/vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'reka-ui'
import { folderName } from '@shared/project/library'
import { useLibraryActions } from '@/composables/useLibraryActions'
import { useNewProjectDrop } from '@/composables/useNewProjectDrop'
import { useLibraryStore } from '@/stores/libraryStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useUiStore } from '@/stores/uiStore'

const FIXED: { kind: 'recent' | 'all'; title: string; icon: Component }[] = [
  { kind: 'recent', title: '最近', icon: History },
  { kind: 'all', title: '全部', icon: LibraryBig },
]

const library = useLibraryStore()
const preferences = usePreferencesStore()
const ui = useUiStore()
const actions = useLibraryActions()
const drop = useNewProjectDrop()

const editing = ref<string | null>(null)
const draft = ref('')
const nameInput = ref<HTMLInputElement[] | null>(null)

function startRename(id: string, name: string) {
  editing.value = id
  draft.value = name
  void nextTick(() => {
    nameInput.value?.[0]?.focus()
    nameInput.value?.[0]?.select()
  })
}

function startNewFavorite() {
  const id = library.createFavorite()
  library.show({ kind: 'favorite', id })
  startRename(id, '新收藏夾')
}

function commitName() {
  if (editing.value === null) return
  preferences.renameFavorite(editing.value, draft.value)
  editing.value = null
}

const rows = ref<HTMLElement | null>(null)

function onRowKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  e.preventDefault()
  const els = rows.value ? [...rows.value.querySelectorAll<HTMLElement>('[data-lib-row]')] : []
  const at = els.indexOf(e.target as HTMLElement)
  if (at === -1) return
  els[at + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
}

onMounted(() => void library.refresh())
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
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.lib-entry:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.lib-entry:disabled {
  opacity: 0.5;
}
.lib-section {
  display: flex;
  align-items: center;
  margin-top: 0.75rem;
  padding: 0 0.375rem 0.25rem;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--muted-foreground);
}
.lib-add {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  margin-left: auto;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
}
.lib-add:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.lib-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  text-align: left;
  cursor: default;
  user-select: none;
}
.lib-row:hover {
  background: var(--secondary);
}
.lib-row-on,
.lib-row-on:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}
.lib-count {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
</style>
