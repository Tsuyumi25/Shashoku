<template>
  <div class="flex h-full w-full flex-col">
    <div
      v-if="project.isOpen"
      class="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 select-none"
    >
      <span class="text-xs text-muted-foreground">
        已選 {{ exportSelection.selected.length }} / {{ project.files.length }} 頁
      </span>
      <!-- One control, because pressing it again is what "none" means. -->
      <button
        class="grid-action ml-auto flex items-center gap-1.5"
        @click="exportSelection.toggleAll()"
      >
        <span class="pick" :data-checked="String(exportSelection.allSelected)">
          <Check :size="11" :stroke-width="3" />
        </span>
        <span>全選</span>
      </button>
    </div>

    <div v-if="!project.isOpen" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        左邊的清單就是你的專案櫃。用「新增」把一個裝著原圖的資料夾建成專案,或用「加入資料夾」把已經做過的一批列進來。
      </p>
    </div>

    <div v-else-if="project.files.length === 0" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        還沒有頁面。左邊挑要用的圖,按「建立 N 頁」——那一步會把像素複製進專案,之後原圖搬走或刪掉都不影響。
      </p>
    </div>

    <!-- Dragging across the grid picks pages; it must never start highlighting page
         names instead. -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto p-2 select-none">
      <!--
        The whole cell is the drag handle. A grip would be one more target on a
        cell whose whole point is the picture, and the only other thing a drag
        here could have meant is selecting text, which is already off.
      -->
      <Draggable
        :model-value="project.files"
        item-key="pageId"
        class="grid items-start gap-2"
        :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }"
        @change="onDropped"
      >
        <template #item="{ element }">
          <ContextMenuRoot>
            <ContextMenuTrigger>
              <PageThumb
                :file="element"
                :selected="exportSelection.isSelected(element.pageId)"
                @pick="onPick(element.pageId, $event)"
              />
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent class="menu">
                <ContextMenuItem class="menu-item menu-item-danger" @select="ask(element)">
                  刪除頁面…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </template>
      </Draggable>
    </div>

    <!--
      A dialog rather than an undo, because there is no undo to offer: the
      directory goes first and nothing here can put one back. Everything else
      destructive in this program answers Delete without asking, and can,
      because the stack is behind it.
    -->
    <AlertDialogRoot :open="asking !== null" @update:open="onDialogOpen">
      <AlertDialogPortal>
        <AlertDialogOverlay class="fixed inset-0 z-50 bg-black/50" />
        <AlertDialogContent class="dialog">
          <AlertDialogTitle class="text-sm font-medium">
            刪除「{{ asking?.page.name }}」?
          </AlertDialogTitle>
          <AlertDialogDescription class="text-xs leading-relaxed text-muted-foreground">
            這一頁的資料夾會從磁碟移除,連同它的圖層和已經嵌上的文字。這一步無法復原——資料夾裡的原圖不受影響,但這一頁做過的工作會消失。
          </AlertDialogDescription>
          <p v-if="problem" class="text-xs text-destructive">{{ problem }}</p>
          <div class="mt-1 flex justify-end gap-2">
            <AlertDialogCancel class="dialog-button">取消</AlertDialogCancel>
            <AlertDialogAction class="dialog-button dialog-button-danger" @click="confirm">
              刪除
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Draggable from 'vuedraggable'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from 'reka-ui'
import { Check } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import PageThumb from '@/components/PageThumb.vue'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { useEditorStore } from '@/stores/editorStore'
import { useExportStore } from '@/stores/exportStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const preferences = usePreferencesStore()
const exportSelection = useExportStore()
const editor = useEditorStore()

// Nothing composites without the catalogue, and this view can be the first one
// a session ever reaches.
onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('font enumeration failed', err)
  })
})

function onPick(pageId: string, e: MouseEvent) {
  if (e.shiftKey) exportSelection.extendTo(pageId)
  else if (e.ctrlKey || e.metaKey) exportSelection.toggle(pageId)
  else exportSelection.only(pageId)
}

/**
 * Which page moved comes from the event rather than from comparing the two
 * orders: the first place they differ is the destination as often as it is the
 * source, and telling those apart afterwards is guesswork.
 */
function onDropped(e: { moved?: { element: ProjectFile; newIndex: number } }) {
  if (!e.moved) return
  editor.cmdMovePage(e.moved.element.pageId, e.moved.newIndex)
}

const asking = ref<ProjectFile | null>(null)
const problem = ref<string | null>(null)

function ask(file: ProjectFile) {
  problem.value = null
  asking.value = file
}

function onDialogOpen(open: boolean) {
  if (!open) asking.value = null
}

async function confirm(e: Event) {
  const file = asking.value
  if (!file) return
  // Held open until the directory is really gone, so a deletion that failed
  // says so where it was asked for rather than closing as though it worked.
  e.preventDefault()
  try {
    await project.deletePage(file.pageId)
  } catch (err) {
    problem.value = `刪不掉:${err instanceof Error ? err.message : String(err)}`
    return
  }
  // The workbench may have been standing on it.
  if (editor.currentPageId === file.pageId) {
    editor.startOnPage(project.files[0]?.pageId ?? null)
  }
  asking.value = null
}
</script>

<style scoped>
.grid-action {
  cursor: pointer;
  height: 1.375rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.grid-action:hover {
  background: var(--secondary);
  color: var(--foreground);
}

.menu {
  z-index: 50;
  min-width: 9rem;
  padding: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
}
.menu-item {
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  outline: none;
}
.menu-item[data-highlighted] {
  background: var(--secondary);
}
.menu-item-danger {
  color: var(--destructive);
}

.dialog {
  position: fixed;
  z-index: 50;
  top: 50%;
  left: 50%;
  display: flex;
  width: min(24rem, calc(100vw - 2rem));
  transform: translate(-50%, -50%);
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.28);
}
.dialog-button {
  cursor: pointer;
  height: 1.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  font-size: 0.75rem;
}
.dialog-button:hover {
  background: var(--secondary);
}
.dialog-button-danger {
  border-color: transparent;
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.dialog-button-danger:hover {
  filter: brightness(1.08);
}
</style>
