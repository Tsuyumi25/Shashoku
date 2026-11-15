<template>
  <div ref="cellRef" class="flex cursor-default flex-col gap-1 rounded-[5px] p-1 select-none hover:bg-secondary">
    <div
      class="relative aspect-[3/4] w-full overflow-hidden rounded-[3px]"
      :class="current && 'ring-2 ring-primary ring-offset-1 ring-offset-popover'"
    >
      <img v-if="src" :src="src" class="h-full w-full object-cover" alt="" draggable="false" />
      <div v-else class="flex h-full w-full items-center justify-center bg-muted/40 px-1 text-center">
        <span v-if="problem" class="text-xs text-destructive">{{ problem }}</span>
        <ImageOff v-else-if="file.badge !== 'ok'" :size="14" class="text-muted-foreground" />
        <Loader v-else :size="14" class="animate-spin text-muted-foreground" />
      </div>
    </div>

    <div class="flex min-w-0 items-baseline gap-1.5 text-xs">
      <span class="shrink-0 tabular-nums" :class="current ? 'text-primary' : 'text-muted-foreground'">
        {{ number }}
      </span>
      <span class="min-w-0 truncate" :class="current ? '' : 'text-muted-foreground'" :title="file.page.name">
        {{ file.page.name }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { ImageOff, Loader } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import { usePageThumbnail } from '@/composables/usePageThumbnail'

const props = defineProps<{ file: ProjectFile; number: number; current: boolean }>()

const cellRef = useTemplateRef<HTMLElement>('cellRef')
const { src, problem } = usePageThumbnail(cellRef, () => props.file)
</script>
