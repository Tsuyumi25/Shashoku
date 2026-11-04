<template>
  <span
    ref="cellRef"
    class="relative block shrink-0 overflow-hidden rounded-xs bg-muted/40"
    :class="fill ? 'w-full' : 'w-1/2'"
    :style="{ aspectRatio: `${file.page.width} / ${file.page.height}` }"
  >
    <img
      v-if="src"
      :src="src"
      class="absolute inset-0 h-full w-full object-contain"
      alt=""
      draggable="false"
    />
    <ImageOff
      v-else-if="problem || file.badge !== 'ok'"
      :size="16"
      class="absolute inset-0 m-auto text-muted-foreground"
    />
  </span>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { ImageOff } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import { usePageThumbnail } from '@/composables/usePageThumbnail'

const props = defineProps<{
  file: ProjectFile
  /** The whole width it is given, rather than the half a list row leaves it. */
  fill?: boolean
}>()

const cellRef = useTemplateRef<HTMLElement>('cellRef')
const { src, problem } = usePageThumbnail(cellRef, () => props.file, 'artwork')
</script>
