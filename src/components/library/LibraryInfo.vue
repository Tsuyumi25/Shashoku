<template>
  <div class="flex min-h-0 flex-1 flex-col border-l border-border bg-card">
    <div v-if="!entry && !leaf" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[14rem] text-center text-sm text-muted-foreground">
        挑一本書、一個資料夾或一張圖，這裡就講它的事。
      </p>
    </div>

    <div v-else-if="leaf" class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="mx-auto w-32">
        <LibraryCover :cover="leaf.cover" />
      </div>

      <p class="mt-3 text-sm break-words">{{ leaf.name }}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">頁面</p>

      <dl class="mt-3">
        <dt class="text-xs text-muted-foreground">位置</dt>
        <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
          {{ leafPath }}
        </dd>
      </dl>

      <div class="mt-3">
        <button class="info-btn" @click="openLeaf">
          <BookOpen :size="14" />
          <span>在編輯器打開這一頁</span>
        </button>
      </div>
    </div>

    <div v-else-if="entry" class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="mx-auto w-32">
        <LibraryCover :cover="entry.cover" :empty="emptyIcon" />
      </div>

      <p class="mt-3 text-sm break-words">{{ entry.name }}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ kindLabel }}</p>

      <dl class="mt-3 space-y-2">
        <div v-if="entry.pageCount !== null">
          <dt class="text-xs text-muted-foreground">頁數</dt>
          <dd class="text-sm tabular-nums">{{ entry.pageCount }}</dd>
        </div>
        <div v-else-if="entry.books !== null">
          <dt class="text-xs text-muted-foreground">書</dt>
          <dd class="text-sm tabular-nums">{{ entry.books }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">位置</dt>
          <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
            {{ entry.path }}
          </dd>
        </div>
      </dl>

      <div class="mt-3 flex flex-col gap-1">
        <button v-if="entry.book" class="info-btn" @click="openBook">
          <BookOpen :size="14" />
          <span>{{ isOpenProject ? '回到編輯器' : '開啟' }}</span>
        </button>
        <button v-if="entry.folder" class="info-btn" @click="library.standAt(entry.path)">
          <FolderOpen :size="14" />
          <span>走進去</span>
        </button>
        <button class="info-btn" @click="reveal">
          <FolderSearch :size="14" />
          <span>在檔案管理員中顯示</span>
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, File, Folder, FolderOpen, FolderSearch, ImageOff, Package } from '@lucide/vue'
import { useToast } from 'vue-toastification'
import { DIR_PAGES, SHASHOKU_DIR } from '@shared/ssk/constants'
import LibraryCover from '@/components/library/LibraryCover.vue'
import { useOpenProject } from '@/composables/useOpenProject'
import { useEditorStore } from '@/stores/editorStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const library = useLibraryStore()
const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()
const { openPath, lastError } = useOpenProject()
const toast = useToast()

const entry = computed(() => library.picked)
const leaf = computed(() => library.pickedLeaf)

const isOpenProject = computed(() => entry.value?.path === project.folderPath)

const kindLabel = computed(() => {
  const picked = entry.value
  if (picked === null) return ''
  if (picked.own) return 'Shashoku 存這本書的地方'
  if (picked.book) return '書'
  if (picked.books !== null) return '工作區'
  if (picked.folder) return '資料夾'
  return picked.cover ? '圖片' : '檔案'
})

const emptyIcon = computed(() => {
  const picked = entry.value
  if (picked === null) return ImageOff
  if (picked.own) return Package
  if (picked.folder) return Folder
  return File
})

const leafPath = computed(() => {
  const picked = leaf.value
  if (picked === null) return ''
  return `${library.standingAt}/${SHASHOKU_DIR}/${DIR_PAGES}/${picked.id}`
})

async function openBook() {
  const picked = entry.value
  if (picked === null || !picked.book) return
  if (picked.path === project.folderPath) {
    ui.setView('editor')
    return
  }
  if (await openPath(picked.path)) ui.setView('editor')
  else if (lastError.value) toast.error(lastError.value)
}

async function openLeaf() {
  const picked = leaf.value
  const book = library.standingAt
  if (picked === null || book === null) return
  if (book !== project.folderPath && !(await openPath(book))) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  editor.startOnPage(picked.id)
  ui.setView('editor')
}

async function reveal() {
  const picked = entry.value
  if (picked === null) return
  // A file is shown by opening the folder it sits in; the platform's opener
  // would otherwise launch it in whatever application claims the type.
  const target = picked.folder ? picked.path : (library.standingAt ?? picked.path)
  const reason = await window.api.openProjectFolder(target)
  if (reason) toast.error(`開不了資料夾:${reason}`)
}
</script>

<style scoped>
.info-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  height: 1.75rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.info-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
