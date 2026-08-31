<template>
  <div class="flex min-h-0 flex-1 flex-col border-l border-border bg-card">
    <div v-if="many.length > 1" class="min-h-0 flex-1 overflow-y-auto p-3">
      <p class="text-sm">選了 {{ many.length }} 個</p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ tally }}</p>

      <dl class="mt-3">
        <dt class="text-xs text-muted-foreground">位置</dt>
        <dd class="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[0.6875rem] break-all select-text">
          {{ library.standingAt ?? '書庫' }}
        </dd>
      </dl>

      <div class="stack mt-5">
        <div
          v-for="(item, at) in stacked"
          :key="item.key"
          class="stack-card"
          :style="{ zIndex: stacked.length - at, transform: shift(at) }"
        >
          <LibraryCover :cover="item.kind === 'page' ? item.page.cover : item.entry.cover" />
        </div>
      </div>

      <p v-if="many.length > stacked.length" class="mt-3 text-center text-xs text-muted-foreground">
        還有 {{ many.length - stacked.length }} 個沒畫出來
      </p>
    </div>

    <div v-else-if="!entry && !leaf" class="flex flex-1 items-center justify-center p-6">
      <p class="max-w-[14rem] text-center text-sm text-muted-foreground">
        挑一本書、一個資料夾或一張圖，這裡就講它的事。
      </p>
    </div>

    <div v-else-if="leaf" class="min-h-0 flex-1 overflow-y-auto p-3">
      <p class="text-sm break-words">{{ leaf.name }}</p>
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

      <LibraryCover class="mt-4" :cover="leaf.cover" natural />
    </div>

    <div v-else-if="entry" class="min-h-0 flex-1 overflow-y-auto p-3">
      <p class="text-sm break-words">{{ entry.name }}</p>
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

      <LibraryCover class="mt-4" :cover="entry.cover" :empty="emptyIcon" natural />
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

const many = computed(() => library.chosenItems)

/** Enough to read as a pile without asking for a decode per card. */
const STACKED = 4

const stacked = computed(() => many.value.slice(0, STACKED))

function shift(at: number): string {
  return `translate(${at * 9}px, ${at * 7}px) rotate(${at * 1.6}deg)`
}

const tally = computed(() => {
  let pages = 0
  let books = 0
  let rest = 0
  for (const item of many.value) {
    if (item.kind === 'page') pages++
    else if (item.entry.book) books++
    else rest++
  }
  return [
    pages > 0 ? `${pages} 頁` : '',
    books > 0 ? `${books} 本書` : '',
    rest > 0 ? `${rest} 個檔案或資料夾` : '',
  ]
    .filter(Boolean)
    .join('、')
})

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

.stack {
  position: relative;
  width: 62%;
  margin-inline: auto;
  aspect-ratio: 3 / 4;
}
.stack-card {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--card);
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
}
</style>
