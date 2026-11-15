<template>
  <DialogRoot :open="ui.newProjectOpen" @update:open="(v) => (ui.newProjectOpen = v)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        class="sheet-panel"
        :aria-describedby="undefined"
        @keydown.enter.exact="onEnter"
        @dragenter="onDragOver"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <header class="shrink-0 px-10 pt-9 pb-6">
          <DialogTitle class="text-2xl font-semibold tracking-tight">新增專案</DialogTitle>
          <p class="mt-1.5 text-sm text-muted-foreground">
            從一個資料夾裡的圖片建立專案。專案會住在那個資料夾裡，原圖只會被複製，不會被修改。
          </p>

          <div class="route mt-6">
            <div class="route-cell">
              <span class="route-label">來源</span>
              <div class="flex min-w-0 items-center gap-2">
                <FolderOpen :size="15" class="shrink-0 text-muted-foreground" />
                <span v-if="source" class="min-w-0 truncate font-mono text-[0.8125rem]" :title="source">{{ source }}</span>
                <span v-else class="text-sm text-muted-foreground">尚未選擇</span>
              </div>
            </div>
            <ArrowRight :size="16" class="shrink-0 text-muted-foreground" />
            <div class="route-cell">
              <span class="route-label">專案</span>
              <div class="flex min-w-0 items-center gap-2">
                <BookPlus :size="15" class="shrink-0 text-muted-foreground" />
                <span v-if="destination" class="min-w-0 truncate font-mono text-[0.8125rem]" :title="destination">{{ destination }}</span>
                <span v-else class="text-sm text-muted-foreground">跟著來源</span>
              </div>
            </div>
          </div>
        </header>

        <div class="relative min-h-0 flex-1 overflow-y-auto px-10 select-none">
          <div
            v-if="state !== 'images'"
            class="drop-zone"
            :class="dropping && 'drop-zone-on'"
            role="button"
            tabindex="0"
            @click="pick"
            @keydown.enter.self.prevent="pick"
          >
            <template v-if="state === 'loading'">
              <span class="text-sm text-muted-foreground">讀取中…</span>
            </template>
            <template v-else>
              <FolderInput :size="40" :stroke-width="1.25" class="text-muted-foreground" />
              <span class="text-base font-medium">{{ headline }}</span>
              <button v-if="state === 'project'" class="panel-btn" @click.stop="openExisting">打開這個專案</button>
              <span class="text-sm text-muted-foreground">
                {{ state === 'empty' ? '或點這裡選擇資料夾…' : '拖進另一個資料夾，或點這裡重新選擇' }}
              </span>
            </template>
          </div>
          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] items-start gap-3 rounded-lg pb-4">
            <div
              v-for="(entry, at) in images"
              :key="entry.name"
              class="relative flex cursor-default flex-col gap-1.5 rounded-md p-1.5 transition-opacity"
              :class="picked.has(entry.name) ? 'hover:bg-secondary' : 'opacity-35 hover:opacity-60'"
              :title="entry.name"
              @click="onPick(at, $event)"
            >
              <LibraryCover :cover="entry.cover" class="rounded-sm" />
              <span
                class="absolute top-3 left-3 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm"
                :class="picked.has(entry.name) ? 'border-foreground bg-foreground text-background' : 'border-border bg-background/90'"
              >
                <Check v-if="picked.has(entry.name)" :size="12" :stroke-width="3" />
              </span>
              <div class="flex min-w-0 items-baseline gap-1.5 text-xs">
                <span class="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{{ orderOf.get(entry.name) ?? '' }}</span>
                <span class="min-w-0 truncate">{{ entry.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="state === 'images'" class="tray shrink-0">
          <span class="route-label shrink-0">頁序</span>
          <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1">
            <div v-for="(entry, at) in chosen" :key="entry.name" class="tray-page" :title="`${at + 1}. ${entry.name}`">
              <LibraryCover :cover="entry.cover" class="rounded-[2px]" />
              <span class="text-[0.625rem] text-muted-foreground tabular-nums">{{ at + 1 }}</span>
            </div>
            <span v-if="chosen.length === 0" class="self-center text-xs text-muted-foreground">沒有選任何一頁</span>
          </div>
        </div>

        <footer class="flex shrink-0 items-center gap-3 border-t border-border px-10 py-4">
          <template v-if="state === 'images'">
            <button class="quiet-btn" @click="selectAll(true)">全選</button>
            <button class="quiet-btn" @click="selectAll(false)">全不選</button>
            <span class="ml-2 text-xs text-muted-foreground tabular-nums">
              {{ picked.size }} / {{ images.length }} 頁 · 複製約 {{ copySize }}
            </span>
          </template>
          <div class="flex-1" />
          <DialogClose class="panel-btn">取消</DialogClose>
          <button class="create-btn" :disabled="!canCreate" @click="create">
            {{ creating ? '建立中…' : createLabel }}
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { ArrowRight, BookPlus, Check, FolderInput, FolderOpen } from '@lucide/vue'
import { SHASHOKU_DIR } from '@shared/ssk/constants'
import type { DirEntry } from '@shared/project/workspace'
import LibraryCover from '@/components/library/LibraryCover.vue'
import { useLibraryPageOrder } from '@/composables/useLibraryPageOrder'
import { useOpenProject } from '@/composables/useOpenProject'
import { useLibraryStore } from '@/stores/libraryStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useUiStore } from '@/stores/uiStore'

type SourceState = 'empty' | 'loading' | 'project' | 'occupied' | 'archive' | 'none' | 'images'

const ARCHIVE_EXTENSIONS = ['.zip', '.cbz']

const ui = useUiStore()
const library = useLibraryStore()
const { importFilesAt } = useLibraryPageOrder()
const { openPath, lastError } = useOpenProject()

const source = ref<string | null>(null)
const kind = ref<'loading' | 'project' | 'occupied' | 'archive' | 'folder' | null>(null)
const images = ref<DirEntry[]>([])
const picked = ref(new Set<string>())
const anchor = ref<number | null>(null)
const dropping = ref(false)
const creating = ref(false)

const state = computed<SourceState>(() => {
  if (source.value === null) return 'empty'
  if (kind.value === 'loading' || kind.value === null) return 'loading'
  if (kind.value !== 'folder') return kind.value
  return images.value.length === 0 ? 'none' : 'images'
})

const destination = computed(() => (source.value === null ? null : `${source.value}/${SHASHOKU_DIR}/`))
const chosen = computed(() => images.value.filter((e) => picked.value.has(e.name)))
const orderOf = computed(() => new Map(chosen.value.map((e, at) => [e.name, at + 1])))

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const copySize = computed(() => {
  const bytes = chosen.value.reduce((sum, e) => sum + (e.cover?.size ?? 0), 0)
  if (bytes >= 1024 ** 3) return `${sizeFormat.format(bytes / 1024 ** 3)} GB`
  if (bytes >= 1024 ** 2) return `${sizeFormat.format(bytes / 1024 ** 2)} MB`
  return `${sizeFormat.format(bytes / 1024)} KB`
})

const canCreate = computed(() => state.value === 'images' && picked.value.size > 0 && !creating.value)

const headline = computed(() => {
  switch (state.value) {
    case 'project':
      return '這個資料夾已經是專案了'
    case 'occupied':
      return `這個資料夾裡已經有 ${SHASHOKU_DIR}/，但不是完整的專案，先沒有動它`
    case 'archive':
      return '壓縮檔還不能直接建立專案，先解壓成資料夾'
    case 'none':
      return '這個資料夾裡沒有圖片'
    default:
      return '把裝著原圖的資料夾拖進來'
  }
})

const createLabel = computed(() => {
  if (state.value !== 'images' || picked.value.size === 0) return '建立專案'
  if (picked.value.size === images.value.length) return `建立專案（全部 ${picked.value.size} 頁）`
  return `建立專案（${picked.value.size} 頁）`
})

let generation = 0

watch(
  () => ui.newProjectOpen,
  (open) => {
    if (open) {
      const handed = ui.newProjectSource
      ui.newProjectSource = null
      if (handed !== null) void useSource(handed)
      return
    }
    generation += 1
    source.value = null
    kind.value = null
    images.value = []
    picked.value = new Set()
    dropping.value = false
  },
)

async function useSource(path: string) {
  const mine = ++generation
  source.value = path
  images.value = []
  picked.value = new Set()
  anchor.value = null
  if (ARCHIVE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))) {
    kind.value = 'archive'
    return
  }
  kind.value = 'loading'
  try {
    const scan = await window.api.scanRoot(path)
    if (mine !== generation) return
    if (scan.hasSentinel) {
      kind.value = 'project'
      return
    }
    if (scan.hasShashokuDir) {
      kind.value = 'occupied'
      return
    }
    const contents = await window.api.listInside(path)
    if (mine !== generation) return
    images.value = contents.entries.filter((e) => !e.folder && e.cover !== null)
    picked.value = new Set(images.value.map((e) => e.name))
    kind.value = 'folder'
  } catch (err) {
    console.error('reading the source folder failed', err)
    if (mine !== generation) return
    images.value = []
    kind.value = 'folder'
  }
}

async function pick() {
  if (state.value === 'loading') return
  const path = await window.api.pickRoot()
  if (path !== null) await useSource(path)
}

function onDragOver(e: DragEvent) {
  if (state.value === 'images' || creating.value) return
  e.preventDefault()
  dropping.value = true
}

function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) dropping.value = false
}

function onDrop(e: DragEvent) {
  dropping.value = false
  if (creating.value || state.value === 'images') return
  const file = e.dataTransfer?.files[0]
  if (!file) return
  const path = window.api.pathForFile(file)
  if (path) void useSource(path)
}

function onPick(at: number, e: MouseEvent) {
  const name = images.value[at]!.name
  const next = new Set(picked.value)
  if (e.shiftKey && anchor.value !== null) {
    const on = next.has(images.value[anchor.value]!.name)
    const [lo, hi] = anchor.value <= at ? [anchor.value, at] : [at, anchor.value]
    for (const entry of images.value.slice(lo, hi + 1)) {
      if (on) next.add(entry.name)
      else next.delete(entry.name)
    }
  } else if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  anchor.value = at
  picked.value = next
}

function selectAll(on: boolean) {
  picked.value = on ? new Set(images.value.map((e) => e.name)) : new Set()
}

function onEnter(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  if (!canCreate.value) return
  e.preventDefault()
  void create()
}

async function open(book: string) {
  ui.newProjectOpen = false
  if (await openPath(book)) ui.setView('editor')
  else if (lastError.value) useNoticeStore().say(lastError.value)
}

async function openExisting() {
  if (source.value !== null) await open(source.value)
}

async function create() {
  const book = source.value
  if (book === null || !canCreate.value) return
  creating.value = true
  try {
    await importFilesAt(book, chosen.value.map((e) => e.name), 0, true)
    const scan = await window.api.scanRoot(book)
    if (!scan.hasSentinel) return
    void library.refresh()
    await open(book)
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.route {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.route-cell {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.375rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--card);
  padding: 0.625rem 0.75rem;
}
.route-label {
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--muted-foreground);
}
.drop-zone {
  display: flex;
  width: 100%;
  min-height: 18rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 0.75rem;
  border: 2px dashed var(--border);
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.drop-zone:hover,
.drop-zone-on {
  border-color: color-mix(in oklch, var(--foreground) 35%, transparent);
  background: color-mix(in oklch, var(--secondary) 60%, transparent);
}
.tray {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--card);
  padding: 0.5rem 2.5rem;
}
.tray-page {
  display: flex;
  width: 2.25rem;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}
.quiet-btn {
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.quiet-btn:hover {
  color: var(--foreground);
  text-decoration: underline;
}
.create-btn {
  height: 2.25rem;
  border-radius: 0.375rem;
  background: var(--primary);
  padding: 0 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--primary-foreground);
}
.create-btn:hover:not(:disabled) {
  background: color-mix(in oklch, var(--primary), black 8%);
}
.create-btn:disabled {
  background: var(--secondary);
  color: var(--muted-foreground);
}
</style>
