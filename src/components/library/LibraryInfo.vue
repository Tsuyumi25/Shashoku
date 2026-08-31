<template>
  <div class="flex min-h-0 flex-1 flex-col border-l border-border bg-card">
    <div v-if="!node && !leaf" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[14rem] text-center text-sm text-muted-foreground">
        挑一本書、一個資料夾或一張圖，這裡就講它的事。
      </p>
    </div>

    <div v-else-if="leaf" class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="mx-auto w-32">
        <LibraryCover :cover="leaf.cover" />
      </div>

      <p class="mt-3 text-sm break-words">{{ leaf.name }}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ leaf.page ? '頁面' : '圖片' }}</p>

      <dl class="mt-3">
        <dt class="text-xs text-muted-foreground">位置</dt>
        <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
          {{ leafPath }}
        </dd>
      </dl>

      <div v-if="leaf.page" class="mt-3">
        <button class="info-btn" @click="openLeaf">
          <BookOpen :size="14" />
          <span>在編輯器打開這一頁</span>
        </button>
      </div>
    </div>

    <div v-else-if="node" class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="mx-auto w-32">
        <LibraryCover :cover="node.cover" :empty="node.kind === 'folder' ? Folder : ImageOff" />
      </div>

      <p class="mt-3 text-sm break-words">{{ node.name }}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ kindLabel }}</p>

      <dl class="mt-3 space-y-2">
        <div>
          <dt class="text-xs text-muted-foreground">{{ node.kind === 'book' ? '頁數' : '書' }}</dt>
          <dd class="text-sm tabular-nums">
            {{ node.kind === 'book' ? node.pageCount : node.books }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">位置</dt>
          <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
            {{ node.path }}
          </dd>
        </div>
      </dl>

      <div class="mt-3 flex flex-col gap-1">
        <button v-if="node.kind === 'book'" class="info-btn" @click="openBook">
          <BookOpen :size="14" />
          <span>{{ isOpenProject ? '回到編輯器' : '開啟' }}</span>
        </button>
        <button class="info-btn" @click="reveal">
          <FolderSearch :size="14" />
          <span>在檔案管理員中顯示</span>
        </button>
      </div>

      <div class="mt-4 border-t border-border pt-3">
        <p class="text-xs text-muted-foreground">標籤</p>
        <p class="mt-1 text-xs text-muted-foreground/70">
          還沒有模型。`project.json` 現在的 `tags` 是頁面上物件的顏色，不是書的標籤。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Folder, FolderSearch, ImageOff } from '@lucide/vue'
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

const node = computed(() => library.pickedNode)
const leaf = computed(() => library.pickedLeaf)

const isOpenProject = computed(() => node.value?.path === project.folderPath)

const kindLabel = computed(() => {
  const picked = node.value
  if (picked === null) return ''
  if (picked.kind === 'book') return '書'
  return picked.workspace ? '工作區' : '資料夾'
})

const leafPath = computed(() => {
  const picked = leaf.value
  if (picked === null) return ''
  if (picked.page) return `${library.standingAt}/${SHASHOKU_DIR}/${DIR_PAGES}/${picked.id}`
  return picked.cover ? `${picked.cover.dir}/${picked.cover.file}` : picked.name
})

async function openBook() {
  const picked = node.value
  if (picked === null || picked.kind !== 'book') return
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
  if (picked === null || !picked.page || book === null) return
  if (book !== project.folderPath && !(await openPath(book))) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  editor.startOnPage(picked.id)
  ui.setView('editor')
}

async function reveal() {
  const picked = node.value
  if (picked === null) return
  const reason = await window.api.openProjectFolder(picked.path)
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
