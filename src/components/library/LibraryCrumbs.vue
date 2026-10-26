<template>
  <div class="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs">
    <button
      v-if="library.recent"
      class="crumb crumb-here"
      @click="library.showRecent()"
    >
      最近
    </button>
    <button
      v-else
      class="crumb"
      :class="library.standingAt === null && 'crumb-here'"
      @click="library.standAt(null)"
    >
      全部
    </button>
    <template v-for="crumb in library.crumbs" :key="crumb.path">
      <ChevronRight :size="12" class="shrink-0 text-muted-foreground" />
      <button
        class="crumb"
        :class="crumb.path === library.standingAt && 'crumb-here'"
        :title="crumb.path"
        @click="library.standAt(crumb.path)"
      >
        {{ crumb.name }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { useLibraryStore } from '@/stores/libraryStore'

const library = useLibraryStore()
</script>

<style scoped>
.crumb {
  flex-shrink: 0;
  max-width: 12rem;
  overflow: hidden;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crumb:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.crumb-here {
  color: var(--foreground);
}
</style>
