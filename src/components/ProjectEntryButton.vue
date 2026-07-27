<template>
  <button
    type="button"
    class="w-full cursor-pointer rounded-[5px] border text-left select-none"
    :class="[
      open ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-secondary',
      view === 'thumbnail' ? 'flex flex-col gap-1 p-1' : 'flex items-center gap-2 p-1',
    ]"
    :title="project.name"
    @click="emit('pick')"
  >
    <!-- Same treatment as a page in the grid: the cover is the cover, and the
         only box around it is the one that says which project is open. -->
    <div :class="view === 'thumbnail' ? 'w-full' : 'w-10 shrink-0'">
      <ProjectCover :project-path="project.path" :cover="project.cover" />
    </div>
    <span class="min-w-0 truncate text-xs" :class="open ? '' : 'text-muted-foreground'">
      {{ project.name }}
    </span>
  </button>
</template>

<script setup lang="ts">
import type { LibraryProject } from '@shared/project/library'
import ProjectCover from '@/components/ProjectCover.vue'
import type { LibraryView } from '@/stores/libraryStore'

defineProps<{ project: LibraryProject; view: LibraryView; open: boolean }>()
const emit = defineEmits<{ pick: [] }>()
</script>
