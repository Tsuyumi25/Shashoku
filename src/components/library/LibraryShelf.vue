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
        v-if="library.canReachDeep"
        type="single"
        class="seg shrink-0"
        :model-value="library.deep ? 'deep' : 'here'"
        @update:model-value="onReach"
      >
        <ToggleGroupItem value="here" class="seg-item shelf-seg-item" title="只看這一層">
          本層
        </ToggleGroupItem>
        <ToggleGroupItem value="deep" class="seg-item shelf-seg-item" title="連同底下每一層的書">
          全部
        </ToggleGroupItem>
      </ToggleGroupRoot>

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

    <!--
      Books, then folders, then the pictures themselves. A folder and a book
      look the same on disk, which is exactly why the shelf has to say which is
      which: the first band opens, the second is somewhere to go. The headings
      appear only once more than one band is there, since a lone band has
      nothing to be told apart from.
    -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <p v-if="empty" class="px-2 py-8 text-center text-sm text-muted-foreground">
        {{ emptyText }}
      </p>

      <template v-if="library.shownBooks.length > 0">
        <p v-if="banded" class="shelf-head">
          書 <span class="shelf-head-count">{{ library.shownBooks.length }}</span>
        </p>
        <div :class="library.view === 'thumbnail' ? gridClass : ''">
          <LibraryCard
            v-for="node in library.shownBooks"
            :key="node.path"
            :node="node"
            :view="library.view"
            :picked="node.path === library.picked"
            :open="node.path === project.folderPath"
            @pick="library.pick(node.path)"
            @enter="enter(node)"
          />
        </div>
      </template>

      <template v-if="library.shownFolders.length > 0">
        <p v-if="banded" class="shelf-head" :class="library.shownBooks.length > 0 && 'mt-4'">
          資料夾 <span class="shelf-head-count">{{ library.shownFolders.length }}</span>
        </p>
        <div :class="library.view === 'thumbnail' ? gridClass : ''">
          <LibraryCard
            v-for="node in library.shownFolders"
            :key="node.path"
            :node="node"
            :view="library.view"
            :picked="node.path === library.picked"
            :open="false"
            @pick="library.pick(node.path)"
            @enter="enter(node)"
          />
        </div>
      </template>

      <template v-if="library.inside.length > 0">
        <p v-if="banded" class="shelf-head" :class="library.shown.length > 0 && 'mt-4'">
          {{ leafBandName }}
          <span class="shelf-head-count">{{ library.inside.length }}</span>
        </p>
        <div :class="library.view === 'thumbnail' ? gridClass : ''">
          <LibraryLeafCard
            v-for="leaf in library.inside"
            :key="leaf.id"
            :leaf="leaf"
            :view="library.view"
            :picked="leaf.id === library.pickedLeaf?.id"
            @pick="library.pickLeaf(leaf)"
            @enter="openLeaf(leaf)"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { FilePlus, FolderOpen, LayoutGrid, List } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { useToast } from 'vue-toastification'
import { nodeAt, type LibraryNode, type ShelfLeaf } from '@shared/project/workspace'
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

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2'

const empty = computed(
  () => library.shown.length === 0 && library.inside.length === 0 && !library.insideLoading,
)

const banded = computed(
  () =>
    [library.shownBooks.length, library.shownFolders.length, library.inside.length].filter(
      (n) => n > 0,
    ).length > 1,
)

const leafBandName = computed(() => (library.standing?.kind === 'book' ? '頁面' : '圖片'))

const emptyText = computed(() => {
  if (library.roots.length === 0) return '左邊按「加入工作區」，把一個裝著書的資料夾放進來。'
  if (library.standing === null) return '還沒有工作區。'
  if (library.standing.kind === 'book') return '這本書還沒有頁面。'
  return library.deep ? '這底下一本書都沒有。' : '這一層什麼都沒有。切到「全部」看看底下有沒有。'
})

function onReach(v: unknown) {
  if (v === 'here' || v === 'deep') library.deep = v === 'deep'
}

// A single-value toggle group can also clear itself, and there is no such thing
// as showing the shelf in no view at all.
function onView(v: unknown) {
  if (v === 'list' || v === 'thumbnail') library.view = v
}

function enter(node: LibraryNode) {
  library.standAt(node.path)
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
.shelf-head {
  margin-bottom: 0.375rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.shelf-head-count {
  margin-left: 0.25rem;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
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
.shelf-seg-item {
  padding: 0 0.5rem;
  font-size: 0.75rem;
  white-space: nowrap;
}
.shelf-view-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  padding: 0;
}
</style>
