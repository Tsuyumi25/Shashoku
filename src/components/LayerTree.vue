<template>
  <div class="h-full min-h-0 overflow-y-auto select-none">
    <div v-if="rows.length === 0" class="px-2 py-4 text-center text-xs text-muted-foreground">
      {{ editor.currentFilename ? '本頁沒有圖層' : '尚未開啟頁面' }}
    </div>

    <div
      v-for="row in rows"
      :key="row.entry.id"
      class="flex h-7 items-center gap-1 border-b border-border/40 pr-1"
      :class="[
        isSelected(row.entry.id) ? 'bg-accent/50' : 'hover:bg-secondary/40',
        row.hiddenByAncestor && 'opacity-40',
      ]"
      :style="{ paddingLeft: `${row.depth * 0.75 + 0.25}rem` }"
      @click="onPick(row)"
    >
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

      <span
        class="min-w-0 flex-1 truncate text-xs"
        :class="isUntitled(row.entry) && 'text-muted-foreground/60 italic'"
      >{{ nameFor(row.entry) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Image, Type } from '@lucide/vue'
import type { LayerEntry } from '@shared/page/types'
import { flattenLayerRows, type LayerTreeRow } from '@/lib/layerRows'
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
const collapsed = ref<Set<string>>(new Set())

const rows = computed(() =>
  currentFile.value ? flattenLayerRows(currentFile.value.page.layers, collapsed.value) : [],
)

function toggleCollapsed(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}

function isSelected(id: string): boolean {
  return id === editor.selectedLabelId
}

function onPick(row: LayerTreeRow) {
  if (row.entry.kind !== 'text') return
  editor.selectedLabelId = row.entry.id
}

function onToggleVisible(entry: LayerEntry) {
  if (!editor.currentFilename) return
  editor.cmdSetLayerVisible(editor.currentFilename, entry.id, !entry.visible)
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
