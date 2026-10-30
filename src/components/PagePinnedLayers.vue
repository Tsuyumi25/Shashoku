<template>
  <div v-if="pinned.length" class="flex min-w-0 flex-col gap-0.5">
    <div
      v-for="row in pinned"
      :key="row.entry.id"
      class="flex h-6 min-w-0 items-center gap-0.5 rounded pr-1"
      :class="[
        editor.isSelected(row.entry.id) ? 'bg-primary/15 text-foreground' : 'hover:bg-background/60',
        row.hiddenByAncestor && 'opacity-40',
      ]"
      @click="editor.selectOnly(row.entry.id)"
    >
      <button
        type="button"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
        :title="row.entry.visible ? '隱藏' : '顯示'"
        @click.stop="editor.cmdSetLayerVisible(pageId, row.entry.id, !row.entry.visible)"
      >
        <Eye v-if="row.entry.visible" :size="13" />
        <EyeOff v-else :size="13" />
      </button>
      <button
        type="button"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded"
        :class="
          row.lockedByAncestor
            ? 'cursor-not-allowed text-muted-foreground/40'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        "
        :title="row.lockedByAncestor ? '由上層資料夾鎖定' : row.entry.locked ? '解鎖' : '鎖定'"
        :disabled="row.lockedByAncestor"
        @click.stop="editor.cmdSetLayerLocked(pageId, row.entry.id, !row.entry.locked)"
      >
        <Lock v-if="row.entry.locked || row.lockedByAncestor" :size="12" />
        <LockOpen v-else :size="12" />
      </button>
      <span class="min-w-0 flex-1 truncate text-xs" :title="`選取「${row.entry.name}」`">{{ row.entry.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Eye, EyeOff, Lock, LockOpen } from '@lucide/vue'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { flattenLayerRows, type LayerTreeRow } from '@/lib/layerRows'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const props = defineProps<{ pageId: string }>()
const project = useProjectStore()
const editor = useEditorStore()

type NamedRow = LayerTreeRow & { entry: RasterLayerEntry | GroupLayerEntry }

/** The page's layers whose names the project pins, in the order the tree stacks them. */
const pinned = computed<NamedRow[]>(() => {
  const names = new Set(project.pinnedLayerNames)
  const file = project.pageById(props.pageId)
  if (!file || names.size === 0) return []
  return flattenLayerRows(file.page.layers, new Set(), editor.textSide).filter(
    (row): row is NamedRow => row.entry.kind !== 'text' && names.has(row.entry.name),
  )
})
</script>
