<template>
  <div
    class="cursor-default rounded-[5px] border p-1 select-none"
    :class="[
      picked ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-secondary',
      view === 'thumbnail' ? 'flex flex-col gap-1' : 'flex items-center gap-2',
    ]"
    :title="node.path"
    @click="emit('pick')"
    @dblclick="emit('enter')"
  >
    <div class="shrink-0" :class="view === 'thumbnail' ? 'w-full' : 'w-10'">
      <div v-if="node.kind === 'folder'" class="relative aspect-[3/4] w-full">
        <div class="absolute inset-x-[12%] top-0 h-[6%] rounded-t-[3px] bg-muted-foreground/25" />
        <div class="absolute inset-x-0 top-[4%] bottom-0 overflow-hidden rounded-[3px]">
          <LibraryCover :cover="node.cover" :empty="Folder" />
        </div>
      </div>
      <LibraryCover v-else :cover="node.cover" />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <span
        class="min-w-0 truncate text-xs"
        :class="open ? 'text-primary' : picked ? '' : 'text-muted-foreground'"
      >
        {{ node.name }}<template v-if="node.kind === 'folder'">/</template>
      </span>
      <span class="text-[0.6875rem] tabular-nums text-muted-foreground">
        {{ node.kind === 'folder' ? `${node.books} 本` : `${node.pageCount} 頁` }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Folder } from '@lucide/vue'
import type { LibraryNode } from '@shared/project/workspace'
import LibraryCover from '@/components/library/LibraryCover.vue'
import type { LibraryView } from '@/stores/libraryStore'

defineProps<{
  node: LibraryNode
  view: LibraryView
  picked: boolean
  /** Whether this is the project currently loaded in the editor. */
  open: boolean
}>()

const emit = defineEmits<{ pick: []; enter: [] }>()
</script>
