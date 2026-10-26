<template>
  <div
    ref="cellRef"
    class="flex cursor-default flex-col gap-1 rounded-[5px] p-1 select-none"
    :class="selected ? 'bg-primary/20' : 'hover:bg-secondary'"
    :title="file.page.name"
  >
    <div class="relative aspect-[3/4] w-full overflow-hidden">
      <!-- Dragging a page picks a run of them; a native image drag would take
           the gesture instead. -->
      <img v-if="src" :src="src" class="h-full w-full object-cover" alt="" draggable="false" />
      <div v-else class="flex h-full w-full items-center justify-center bg-muted/40 px-1 text-center">
        <span v-if="problem" class="text-xs text-destructive">{{ problem }}</span>
        <ImageOff v-else-if="file.badge !== 'ok'" :size="14" class="text-muted-foreground" />
        <Loader v-else :size="14" class="animate-spin text-muted-foreground" />
      </div>

      <span
        v-if="badgeText"
        class="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[10px] text-destructive-foreground"
      >
        {{ badgeText }}
      </span>
    </div>

    <span class="min-w-0 truncate text-xs" :class="selected ? '' : 'text-muted-foreground'">
      {{ file.page.name }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { ImageOff, Loader } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import { usePageThumbnail } from '@/composables/usePageThumbnail'

/**
 * One finished page. This grid is the last stop before delivery, so the cell is
 * the whole page plus what it takes to pick it out of a run.
 */
const props = defineProps<{ file: ProjectFile; selected: boolean }>()

const cellRef = useTemplateRef<HTMLElement>('cellRef')
const { src, problem } = usePageThumbnail(cellRef, () => props.file)

const badgeText = computed(() => {
  switch (props.file.badge) {
    case 'missing':
      return '頁面資料夾不存在'
    case 'damaged':
      return '頁面資料損毀'
    default:
      return null
  }
})
</script>
