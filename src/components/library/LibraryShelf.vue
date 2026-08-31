<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
      <LibraryCrumbs />

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <button class="shelf-btn" title="把一個含有原圖的資料夾建成書" @click="create">
          <FilePlus :size="13" />
          <span>新增</span>
        </button>
        <button class="shelf-btn" title="開啟一本已經做過的書" @click="openPicked">
          <FolderOpen :size="13" />
          <span>開啟</span>
        </button>
      </div>

      <ToggleGroupRoot
        type="single"
        class="seg shrink-0"
        :model-value="library.view"
        @update:model-value="onView"
      >
        <ToggleGroupItem value="list" class="seg-item shelf-view-item" title="清單">
          <List :size="13" />
        </ToggleGroupItem>
        <ToggleGroupItem value="thumbnail" class="seg-item shelf-view-item" title="格狀">
          <LayoutGrid :size="13" />
        </ToggleGroupItem>
      </ToggleGroupRoot>
    </div>

    <!-- Links rather than a tablist: a tablist hides its inactive panels from
         the accessibility tree, and every band here is on screen at once. -->
    <nav v-if="library.bandCount > 1" class="jump">
      <a
        v-if="library.bandPages.length > 0"
        class="jump-item"
        href="#library-band-pages"
        @click="flash('pages')"
      >
        頁面 <span class="jump-count">{{ library.bandPages.length }}</span>
      </a>
      <a
        v-if="library.bandProjects.length > 0"
        class="jump-item"
        href="#library-band-projects"
        @click="flash('projects')"
      >
        書 <span class="jump-count">{{ library.bandProjects.length }}</span>
      </a>
      <a
        v-if="library.bandFiles.length > 0"
        class="jump-item"
        href="#library-band-files"
        @click="flash('files')"
      >
        檔案 <span class="jump-count">{{ library.bandFiles.length }}</span>
      </a>
    </nav>

    <div ref="scroller" class="shelf-scroll">
      <p v-if="isEmpty" class="px-2 py-8 text-center text-sm text-muted-foreground">
        {{ emptyText }}
      </p>

      <div v-else-if="library.standingAt === null" :class="gridClass">
        <LibraryCard
          v-for="entry in library.home"
          :key="entry.path"
          :entry="entry"
          :view="library.view"
          :picked="entry.path === library.picked?.path"
          :open="entry.path === project.folderPath"
          @pick="library.pickEntry(entry)"
          @enter="library.standAt(entry.path)"
        />
      </div>

      <template v-else>
        <section
          v-if="library.bandPages.length > 0"
          id="library-band-pages"
          class="band band-document"
          :class="flashing === 'pages' && 'band-arrived'"
        >
          <p class="band-head">
            頁面 <span class="band-count">{{ library.bandPages.length }}</span>
          </p>
          <div :class="gridClass">
            <LibraryLeafCard
              v-for="leaf in library.bandPages"
              :key="leaf.id"
              :leaf="leaf"
              :view="library.view"
              :picked="leaf.id === library.pickedLeaf?.id"
              @pick="library.pickLeaf(leaf)"
              @enter="openLeaf(leaf)"
            />
          </div>
        </section>

        <section
          v-if="library.bandProjects.length > 0"
          id="library-band-projects"
          class="band band-document"
          :class="flashing === 'projects' && 'band-arrived'"
        >
          <p class="band-head">
            書 <span class="band-count">{{ library.bandProjects.length }}</span>
          </p>
          <div :class="gridClass">
            <LibraryCard
              v-for="entry in library.bandProjects"
              :key="entry.path"
              :entry="entry"
              :view="library.view"
              :picked="entry.path === library.picked?.path"
              :open="entry.path === project.folderPath"
              @pick="library.pickEntry(entry)"
              @enter="enter(entry)"
            />
          </div>
        </section>

        <section
          v-if="library.bandFiles.length > 0"
          id="library-band-files"
          class="band"
          :class="flashing === 'files' && 'band-arrived'"
        >
          <p class="band-head">
            檔案 <span class="band-count">{{ library.bandFiles.length }}</span>
          </p>
          <div :class="gridClass">
            <LibraryCard
              v-for="entry in library.bandFiles"
              :key="entry.path"
              :entry="entry"
              :view="library.view"
              :picked="entry.path === library.picked?.path"
              :open="false"
              @pick="library.pickEntry(entry)"
              @enter="enter(entry)"
            />
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { FilePlus, FolderOpen, LayoutGrid, List } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { useToast } from 'vue-toastification'
import { nodeAt, type DirEntry, type ShelfLeaf } from '@shared/project/workspace'
import LibraryCard from '@/components/library/LibraryCard.vue'
import LibraryCrumbs from '@/components/library/LibraryCrumbs.vue'
import LibraryLeafCard from '@/components/library/LibraryLeafCard.vue'
import { useOpenProject } from '@/composables/useOpenProject'
import { useEditorStore } from '@/stores/editorStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const library = useLibraryStore()
const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()
const { createHere, openPicked: pickAndOpen, openPath, lastError } = useOpenProject()
const toast = useToast()

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2'

/** Kept in step with the animation in the stylesheet below. */
const FLASH_MS = 1500
const NO_SCROLL_MS = 120
const ARMED_MS = 3000

const isEmpty = computed(() => {
  if (library.insideLoading) return false
  if (library.standingAt === null) return library.home.length === 0
  return library.bandCount === 0
})

const emptyText = computed(() => {
  if (library.roots.length === 0) return '左邊按「加入工作區」，把一個裝著書的資料夾放進來。'
  if (library.standingAt === null) return '還沒有工作區。'
  return '這個資料夾是空的。'
})

// A single-value toggle group can also clear itself, and there is no such thing
// as showing the shelf in no view at all.
function onView(v: unknown) {
  if (v === 'list' || v === 'thumbnail') library.view = v
}

/**
 * ⚠️ `scrollend` never fires when the scroll position did not change, and a
 * smooth scroll is not obliged to have started by the next frame. So a first
 * `scroll` is what says one is coming, and its absence is what says none is.
 */
const scroller = ref<HTMLElement | null>(null)
const flashing = ref<string | null>(null)
let armed: string | null = null
let settleTimer = 0
let disarmTimer = 0
let flashTimer = 0

function flash(band: string) {
  armed = band
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  settleTimer = window.setTimeout(() => {
    if (armed === band) fire(band)
  }, NO_SCROLL_MS)
  disarmTimer = window.setTimeout(() => {
    armed = null
  }, ARMED_MS)
}

function fire(band: string) {
  armed = null
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  window.clearTimeout(flashTimer)
  flashing.value = null
  // Re-adding a class to the same element does not restart its animation.
  requestAnimationFrame(() => {
    flashing.value = band
    flashTimer = window.setTimeout(() => {
      flashing.value = null
    }, FLASH_MS)
  })
}

useEventListener(scroller, 'scroll', () => {
  if (armed !== null) window.clearTimeout(settleTimer)
})

useEventListener(scroller, 'scrollend', () => {
  if (armed !== null) fire(armed)
})

onBeforeUnmount(() => {
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  window.clearTimeout(flashTimer)
})

function noticeIfOutside(path: string) {
  if (nodeAt(library.roots, path) !== null) return
  toast.info('這本書不在任何工作區底下,書庫看不到它。要的話把它上面某一層加成工作區。')
}

async function create() {
  if (!(await createHere())) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  if (project.folderPath) noticeIfOutside(project.folderPath)
  ui.setView('pages')
}

async function openPicked() {
  if (!(await pickAndOpen())) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  if (project.folderPath) noticeIfOutside(project.folderPath)
  ui.setView('editor')
}

function enter(entry: DirEntry) {
  if (entry.folder) library.standAt(entry.path)
}

async function openLeaf(leaf: ShelfLeaf) {
  const book = library.standingAt
  if (!leaf.page || book === null) return
  if (book !== project.folderPath && !(await openPath(book))) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  editor.startOnPage(leaf.id)
  ui.setView('editor')
}

onMounted(() => {
  void library.refresh()
})
</script>

<style scoped>
.shelf-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.625rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.shelf-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.shelf-view-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  padding: 0;
}

.jump {
  display: flex;
  flex-shrink: 0;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem 0;
  scroll-target-group: auto;
}
.jump-item {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  text-decoration: none;
  white-space: nowrap;
  transition: color 120ms ease, background 120ms ease;
}
.jump-item:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.jump-item:target-current {
  color: var(--foreground);
}
.jump-count {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.shelf-scroll {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}
.band {
  padding: 0.5rem;
  border-radius: 0.375rem;
  scroll-margin-top: 0.5rem;
}
.band-document {
  background: color-mix(in oklch, var(--primary) 7%, transparent);
}
.band-head {
  margin-bottom: 0.375rem;
  padding: 0.0625rem 0.25rem;
  border-radius: 0.1875rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.band-count {
  margin-left: 0.25rem;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

@keyframes band-arrived {
  0% {
    box-shadow: 0 0 0 2px var(--primary);
  }
  100% {
    box-shadow: 0 0 0 2px transparent;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .shelf-scroll {
    scroll-behavior: smooth;
  }
  .band-arrived {
    animation: band-arrived 1500ms ease-out;
  }
}
</style>
