<template>
  <div
    class="cursor-default rounded-[5px] p-1 select-none"
    :class="[
      selected ? 'bg-primary/20' : 'hover:bg-secondary',
      view === 'thumbnail' ? 'flex flex-col gap-1' : 'flex items-center gap-2',
      !card.found && 'opacity-55',
    ]"
    :title="card.path"
  >
    <div class="relative shrink-0" :class="view === 'thumbnail' ? 'w-full' : 'w-10'">
      <LibraryCover :cover="card.cover" :empty="card.found ? BookOpen : FolderX" />
      <span
        v-if="!card.found"
        class="absolute inset-x-0 bottom-0 bg-background/85 py-0.5 text-center text-[0.6875rem] text-muted-foreground"
      >
        找不到
      </span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1 text-xs" :class="selected ? '' : 'text-muted-foreground'">
        <span v-if="open" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="開在編輯器裡" />
        <span class="min-w-0 truncate">{{ card.name }}</span>
      </span>
      <span class="truncate text-[0.6875rem] text-muted-foreground tabular-nums">
        {{ card.found ? `${card.pageCount} 頁` : card.path }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BookOpen, FolderX } from '@lucide/vue'
import type { ProjectCard } from '@shared/project/workspace'
import LibraryCover from '@/components/library/LibraryCover.vue'
import type { LibraryView } from '@/stores/libraryStore'

defineProps<{
  card: ProjectCard
  view: LibraryView
  selected: boolean
  /** Whether this is the project currently loaded in the editor. */
  open: boolean
}>()
</script>
