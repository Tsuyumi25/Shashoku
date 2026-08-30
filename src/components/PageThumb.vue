<template>
  <button
    ref="cellRef"
    type="button"
    class="flex cursor-pointer flex-col gap-1 rounded-[5px] border p-1 text-left"
    :class="
      selected
        ? 'border-primary bg-primary/10'
        : 'border-transparent hover:border-border hover:bg-secondary'
    "
    @click="emit('pick', $event)"
  >
    <!--
      No frame of its own: a page is a rectangle of paper, and a rounded box
      with a fill behind it would read as a second object around it. What is
      drawn is the page, and the only thing framing it is the picking.
    -->
    <div class="relative">
      <!-- Dragging a page picks a run of them; a native image drag would take
           the gesture instead. -->
      <img v-if="src" :src="src" class="block w-full" alt="" draggable="false" />
      <div
        v-else
        class="flex aspect-[3/4] w-full items-center justify-center bg-muted/40 px-1 text-center"
      >
        <span v-if="problem" class="text-xs text-destructive">{{ problem }}</span>
        <ImageOff v-else-if="file.badge !== 'ok'" :size="16" class="text-muted-foreground" />
        <Loader v-else :size="14" class="animate-spin text-muted-foreground" />
      </div>

      <span
        v-if="badgeText"
        class="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[10px] text-destructive-foreground"
      >
        {{ badgeText }}
      </span>

    </div>

    <!-- Beside the name rather than over the page, which is the one thing in
         this cell nothing should be covering. -->
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="pick" :data-checked="String(selected)">
        <Check :size="12" :stroke-width="3" />
      </span>
      <span class="truncate text-xs" :class="selected ? '' : 'text-muted-foreground'">
        {{ file.page.name }}
      </span>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { Check, ImageOff, Loader } from '@lucide/vue'
import type { ProjectFile } from '@/types/project'
import { usePageThumbnail } from '@/composables/usePageThumbnail'

/**
 * One finished page. This grid is the last stop before delivery, so the cell is
 * the whole page plus what it takes to pick it out of a run.
 */
const props = defineProps<{ file: ProjectFile; selected: boolean }>()
const emit = defineEmits<{ pick: [MouseEvent] }>()

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
