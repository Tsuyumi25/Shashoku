<template>
  <div class="flex h-full w-full flex-col">
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
          <PageThumb
            :file="element"
            :selected="exportSelection.isSelected(element.pageId)"
            @pick="onPick(element.pageId, $event)"
          />
        </template>
      </Draggable>
    </div>

    <!--
      Deleting sits at the far end, as far from picking as the bar is wide. They
      are the two halves of the same mistake — picking everything and then
      pressing the thing beside it.

      The count appears only where nothing else says it. Beside a delete button
      that already carries the number it would be the same figure twice.
    -->
    <div v-if="project.isOpen" class="bar">
      <button
        class="bar-button"
        :disabled="project.files.length === 0"
        @click="exportSelection.toggleAll()"
      >
        <span class="pick" :data-checked="String(exportSelection.allSelected)">
          <Check :size="11" :stroke-width="3" />
        </span>
        <span>全選</span>
      </button>

      <span class="bar-head">
        專案頁面
        <span v-if="tab === 'export'" class="bar-count">
          ({{ exportSelection.selectedPages.length }}/{{ project.files.length }})
        </span>
      </span>

      <button
        v-if="tab === 'source'"
        class="bar-button bar-button-danger ml-auto"
        :disabled="exportSelection.selectedPages.length === 0"
        @click="remove"
      >
        <Trash2 :size="13" />
        <span>刪除 {{ exportSelection.selectedPages.length }} 頁</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import Draggable from 'vuedraggable'
import { Check, Trash2 } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import PageThumb from '@/components/PageThumb.vue'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { useEditorStore } from '@/stores/editorStore'
import { useExportStore } from '@/stores/exportStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The finished pages, whichever tab is up. What the bar underneath offers is
 * what the column beside them is for: making pages out of a folder means being
 * able to unmake them too, while a delivery has nothing to say about which
 * pages exist.
 */
const props = defineProps<{ tab: 'source' | 'export' }>()

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

/**
 * Deletes what is picked, at once and without asking. Ctrl+Z is the answer to
 * a misclick, the same as it is everywhere else in the program — a dialog in
 * front of an undoable act only teaches people to click through dialogs.
 */
function remove() {
  const wasOn = editor.currentPageId
  const deleted = editor.cmdDeletePages(exportSelection.selectedPages.map((f) => f.pageId))
  // The workbench may have been standing on one of them. Undo does not send it
  // back here afterwards: what a command restores is the document, not where
  // you were standing when you ran it.
  if (wasOn !== null && deleted.includes(wasOn)) {
    editor.startOnPage(project.files[0]?.pageId ?? null)
  }
}
</script>
