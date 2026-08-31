<template>
  <div
    class="cursor-default rounded-[5px] border p-1 select-none"
    :class="[
      picked ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-secondary',
      view === 'thumbnail' ? 'flex flex-col gap-1' : 'flex items-center gap-2',
    ]"
    :title="leaf.name"
    @click="emit('pick')"
    @dblclick="emit('enter')"
  >
    <div class="shrink-0" :class="view === 'thumbnail' ? 'w-full' : 'w-10'">
      <LibraryCover :cover="leaf.cover" />
    </div>
    <span class="min-w-0 flex-1 truncate text-xs" :class="picked ? '' : 'text-muted-foreground'">
      {{ leaf.name }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { ShelfLeaf } from '@shared/project/workspace'
import LibraryCover from '@/components/library/LibraryCover.vue'
import type { LibraryView } from '@/stores/libraryStore'

defineProps<{ leaf: ShelfLeaf; view: LibraryView; picked: boolean }>()

const emit = defineEmits<{ pick: []; enter: [] }>()
</script>
