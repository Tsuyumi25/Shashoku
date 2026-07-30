<template>
  <div class="flex h-full min-h-0 flex-col select-none">
    <LayerBlending />

    <div class="min-h-0 flex-1 overflow-y-auto" @dragover.prevent @drop.prevent="onDrop">
      <div v-if="rows.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
        {{ editor.currentFilename ? '本頁沒有圖層' : '尚未開啟頁面' }}
      </div>

      <div
        v-for="row in rows"
        :key="row.entry.id"
        :draggable="renaming?.id !== row.entry.id"
        class="group/row relative flex h-7 items-center gap-1 border-b border-border/40 pr-1"
        :class="[
          isSelected(row.entry.id) ? 'bg-accent/50' : 'hover:bg-secondary/40',
          row.hiddenByAncestor && 'opacity-40',
          hover?.id === row.entry.id && hover.zone === 'inside' && 'ring-1 ring-inset ring-primary',
        ]"
        :style="{ paddingLeft: `${row.depth * 0.75 + 0.25}rem` }"
        @click="onPick(row, $event)"
        @dragstart="onDragStart(row, $event)"
        @dragover.prevent.stop="onDragOver(row, $event)"
        @drop.prevent.stop="onDrop"
        @dragend="clearDrag"
      >
        <span
          v-if="hover?.id === row.entry.id && hover.zone !== 'inside'"
          class="pointer-events-none absolute right-0 left-0 h-0.5 bg-primary"
          :class="hover.zone === 'above' ? 'top-0' : 'bottom-0'"
        />

        <button
          v-if="row.entry.kind === 'group'"
          type="button"
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          :title="collapsed.has(row.entry.id) ? '展開' : '收合'"
          @click.stop="toggleCollapsed(row.entry.id)"
        >
          <ChevronRight v-if="collapsed.has(row.entry.id)" :size="12" />
          <ChevronDown v-else :size="12" />
        </button>
        <span v-else class="w-4 shrink-0" />

        <button
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          :title="row.entry.visible ? '隱藏' : '顯示'"
          @click.stop="onToggleVisible(row.entry)"
        >
          <Eye v-if="row.entry.visible" :size="13" />
          <EyeOff v-else :size="13" />
        </button>

        <component :is="iconFor(row.entry)" :size="12" class="shrink-0 text-muted-foreground" />

        <input
          v-if="renaming?.id === row.entry.id"
          ref="renameEl"
          v-model="renaming.draft"
          type="text"
          class="min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = null"
          @blur="commitRename"
        />
        <span
          v-else
          class="min-w-0 flex-1 truncate text-xs"
          :class="isUntitled(row.entry) && 'text-muted-foreground/60 italic'"
          :title="canRename(row.entry) ? '雙擊改名' : undefined"
          @dblclick.stop="beginRename(row.entry)"
        >{{ nameFor(row.entry) }}</span>

        <button
          v-if="row.entry.kind === 'group'"
          type="button"
          class="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground group-hover/row:flex hover:bg-secondary hover:text-foreground"
          title="解散資料夾（內容留在原地）"
          @click.stop="onDissolve(row.entry.id)"
        >
          <Ungroup :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Image, Type, Ungroup } from '@lucide/vue'
import type { GroupLayerEntry, LayerEntry, RasterLayerEntry } from '@shared/page/types'
import { findEntry } from '@shared/page/tree'
import LayerBlending from '@/components/LayerBlending.vue'
import { dropTargetFor, flattenLayerRows, type LayerTreeRow } from '@/lib/layerRows'
import { zoneAt, type DropZone } from '@/lib/rowDrop'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

/**
 * The open page only. The tree is about how this page stacks, which is a
 * question the next page has its own answer to.
 */
const currentFile = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename) ?? null) : null,
)

// Ids belong to one page, so a folder left collapsed here cannot be mistaken
// for one on another page.
const collapsed = computed(() => editor.collapsedLayerIds)

const rows = computed(() =>
  currentFile.value ? flattenLayerRows(currentFile.value.page.layers, collapsed.value) : [],
)

/** What a range reaches over, in the order the panel is showing it. */
const sequence = computed(() => rows.value.map((r) => r.entry.id))

function toggleCollapsed(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  editor.collapsedLayerIds = next
}

function isSelected(id: string): boolean {
  return editor.isSelected(id)
}

function onPick(row: LayerTreeRow, e: MouseEvent) {
  if (e.shiftKey) editor.extendSelectionTo(row.entry.id, sequence.value)
  else if (e.ctrlKey || e.metaKey) editor.toggleSelected(row.entry.id)
  else editor.selectOnly(row.entry.id)
}

function onToggleVisible(entry: LayerEntry) {
  if (!editor.currentFilename) return
  editor.cmdSetLayerVisible(editor.currentFilename, entry.id, !entry.visible)
}

function onDissolve(folderId: string) {
  if (!editor.currentFilename) return
  editor.cmdDissolveFolder(editor.currentFilename, folderId)
}


const dragging = ref<{ id: string; path: number[] } | null>(null)
const hover = ref<{ id: string; zone: DropZone } | null>(null)

function onDragStart(row: LayerTreeRow, e: DragEvent) {
  dragging.value = { id: row.entry.id, path: row.path }
  // Without a payload Chromium refuses to start the drag at all, even though
  // the drop is resolved from component state rather than from what is carried.
  e.dataTransfer?.setData('text/plain', row.entry.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(row: LayerTreeRow, e: DragEvent) {
  if (dragging.value === null || dragging.value.id === row.entry.id) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  hover.value = { id: row.entry.id, zone: zoneAt(rect, e.clientY, row.entry.kind === 'group') }
}

function onDrop() {
  const from = dragging.value
  const over = hover.value
  clearDrag()
  if (from === null || over === null || !editor.currentFilename) return
  const row = rows.value.find((r) => r.entry.id === over.id)
  if (row === undefined) return
  const target = dropTargetFor(row, over.zone)
  if (target === null) return
  editor.cmdMoveLayer(editor.currentFilename, from.id, from.path, target)
}

function clearDrag() {
  dragging.value = null
  hover.value = null
}


/**
 * A text object is the one row that cannot be renamed: its translation is its
 * identity, so a name of its own would only be a second one that can drift.
 */
function canRename(entry: LayerEntry): entry is GroupLayerEntry | RasterLayerEntry {
  return entry.kind !== 'text'
}

const renaming = ref<{ id: string; draft: string } | null>(null)
const renameEl = useTemplateRef<HTMLInputElement>('renameEl')

async function beginRename(entry: LayerEntry) {
  if (!canRename(entry)) return
  renaming.value = { id: entry.id, draft: entry.name }
  await nextTick()
  // Selected rather than merely focused: an auto-named 資料夾3 is there to be
  // replaced, not appended to.
  renameEl.value?.select()
}

/**
 * Enter and losing focus both land the name, as they do in any tree; Escape
 * clears the draft first, so the blur that follows it finds nothing to commit.
 *
 * An empty name is refused rather than stored — a row with nothing on it could
 * not be told from its neighbours, and the name it had is the better answer.
 */
function commitRename() {
  const editing = renaming.value
  renaming.value = null
  if (editing === null || !editor.currentFilename) return
  const entry = currentFile.value
    ? findEntry(currentFile.value.page.layers, editing.id)
    : undefined
  if (entry === undefined || !canRename(entry)) return
  const name = editing.draft.trim()
  if (name.length === 0) return
  editor.cmdRenameLayer(editor.currentFilename, editing.id, entry.name, name)
}

function iconFor(entry: LayerEntry) {
  if (entry.kind === 'group') return Folder
  if (entry.kind === 'raster') return Image
  return Type
}

function isUntitled(entry: LayerEntry): boolean {
  return entry.kind === 'text' && entry.lines.every((line) => line.length === 0)
}

/**
 * A text object shows its translation rather than a name of its own. The tree
 * and the label list are two views of the same objects, and a name anyone could
 * edit would let one object read differently in each.
 */
function nameFor(entry: LayerEntry): string {
  if (entry.kind !== 'text') return entry.name
  return entry.lines.find((line) => line.length > 0) ?? '(未翻譯)'
}
</script>
