<template>
  <div
    class="cursor-default rounded-[5px] p-1 select-none"
    :class="[
      picked ? 'bg-primary/20' : 'hover:bg-secondary',
      view === 'thumbnail' ? 'flex flex-col gap-1' : 'flex items-center gap-2',
      entry.own && 'opacity-70',
    ]"
    :title="entry.path"
    @click="emit('pick', $event)"
    @dblclick="emit('enter')"
  >
    <div class="shrink-0" :class="view === 'thumbnail' ? 'w-full' : 'w-10'">
      <div v-if="entry.folder" class="relative aspect-[3/4] w-full">
        <div class="absolute inset-x-[12%] top-0 h-[6%] rounded-t-[3px] bg-muted-foreground/25" />
        <div class="absolute inset-x-0 top-[4%] bottom-0 overflow-hidden rounded-[3px]">
          <LibraryCover :cover="entry.cover" :empty="entry.own ? Package : Folder" />
        </div>
      </div>
      <LibraryCover v-else :cover="entry.cover" :empty="File" />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1 text-xs" :class="picked ? '' : 'text-muted-foreground'">
        <span v-if="open" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="開在編輯器裡" />
        <span class="min-w-0 truncate">{{ entry.name }}<template v-if="entry.folder">/</template></span>
      </span>
      <span class="text-[0.6875rem] tabular-nums text-muted-foreground">{{ note }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { File, Folder, Package } from '@lucide/vue'
import type { DirEntry } from '@shared/project/workspace'
import LibraryCover from '@/components/library/LibraryCover.vue'
import type { LibraryView } from '@/stores/libraryStore'

const props = defineProps<{
  entry: DirEntry
  view: LibraryView
  picked: boolean
  /** Whether this is the project currently loaded in the editor. */
  open: boolean
}>()

const emit = defineEmits<{ pick: [MouseEvent]; enter: [] }>()

const note = computed(() => {
  const entry = props.entry
  if (entry.own) return '專案資料'
  if (entry.pageCount !== null) return `${entry.pageCount} 頁`
  if (entry.books !== null) return `${entry.books} 本`
  if (entry.folder) return '資料夾'
  const at = entry.name.lastIndexOf('.')
  return at > 0 ? entry.name.slice(at + 1).toUpperCase() : ' '
})
</script>
