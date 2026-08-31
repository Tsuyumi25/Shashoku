<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-border p-1">
      <button class="lib-entry" title="把一個資料夾加進書庫" @click="library.addWorkspace()">
        <FolderPlus :size="13" />
        <span>加入工作區</span>
      </button>
      <button
        class="lib-entry ml-auto"
        title="重新掃描"
        :disabled="library.scanning"
        @click="library.refresh()"
      >
        <RefreshCw :size="13" :class="library.scanning && 'animate-spin'" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <div
        class="lib-row"
        :class="{ 'lib-row-on': library.standingAt === null }"
        @click="library.standAt(null)"
      >
        <LibraryBig :size="15" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">全部</span>
        <span class="lib-count">{{ totalBooks }}</span>
      </div>

      <p
        v-if="library.roots.length === 0"
        class="px-2 py-3 text-center text-xs text-muted-foreground"
      >
        還沒有工作區。用上面的「加入工作區」把一個裝著書的資料夾放進來——它可以有幾層都行。
      </p>

      <ContextMenuRoot v-for="node in library.roots" :key="node.path">
        <ContextMenuTrigger as-child>
          <div
            class="lib-row"
            :class="{
              'lib-row-on': node.path === library.insideWorkspace || node.path === library.picked,
              'lib-row-open': node.path === project.folderPath,
            }"
            :title="node.path"
            @click="onClick(node)"
          >
            <Book v-if="node.kind === 'book'" :size="15" class="shrink-0 text-muted-foreground" />
            <FolderTree v-else :size="15" class="shrink-0 text-primary" />
            <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
            <span class="lib-count">{{ node.kind === 'book' ? node.pageCount : node.books }}</span>
          </div>
        </ContextMenuTrigger>

        <ContextMenuPortal>
          <ContextMenuContent class="dropdown-content" :collision-padding="8">
            <ContextMenuItem class="dropdown-item" @select="reveal(node.path)">
              <FolderSearch :size="14" />
              <span>在檔案管理員中顯示</span>
            </ContextMenuItem>
            <ContextMenuSeparator class="dropdown-separator" />
            <ContextMenuItem class="dropdown-item" @select="library.removeWorkspace(node.path)">
              <FolderX :size="14" />
              <span>從書庫移除</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  Book,
  FolderPlus,
  FolderSearch,
  FolderTree,
  FolderX,
  LibraryBig,
  RefreshCw,
} from '@lucide/vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'reka-ui'
import { useToast } from 'vue-toastification'
import type { LibraryNode } from '@shared/project/workspace'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'

const library = useLibraryStore()
const project = useProjectStore()
const toast = useToast()

const totalBooks = computed(() =>
  library.roots.reduce((total, node) => total + (node.kind === 'folder' ? node.books : 1), 0),
)

function onClick(node: LibraryNode) {
  library.pick(node.path)
  library.standAt(node.path)
}

async function reveal(path: string) {
  const reason = await window.api.openProjectFolder(path)
  if (reason) toast.error(`開不了資料夾:${reason}`)
}

onMounted(() => {
  void library.refresh()
})
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
.lib-entry:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.lib-entry:disabled {
  opacity: 0.5;
}
.lib-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
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
.lib-row-open {
  color: var(--primary);
}
.lib-count {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
</style>
