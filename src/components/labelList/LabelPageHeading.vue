<template>
  <div
    tabindex="0"
    :data-page-id="page.pageId"
    data-page-heading
    class="sticky top-0 z-10 flex items-center gap-2 border-y border-border px-2 py-1 select-none focus:ring-1 focus:ring-inset focus:ring-primary focus:outline-none"
    :class="[showing && 'text-foreground', here ? 'heading-here' : 'heading-away']"
    @mousedown="emit('turn')"
  >
    <PageRowThumb v-if="file" :file="file" />
    <div class="flex min-w-0 flex-1 flex-col gap-1 self-stretch overflow-hidden">
      <div class="flex min-w-0 items-center gap-2">
        <span class="shrink-0 text-xs text-muted-foreground tabular-nums"
          >第 {{ page.position }} 頁 · {{ page.pageId }}</span
        >
        <span class="min-w-0 truncate text-xs font-medium">{{ page.name }}</span>
        <span class="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
          {{ page.count }}
        </span>
      </div>
      <PagePinnedLayers :page-id="page.pageId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PagePinnedLayers from '@/components/PagePinnedLayers.vue'
import PageRowThumb from '@/components/PageRowThumb.vue'
import type { PageRow } from '@/lib/labelRows'
import type { ProjectFile } from '@/types/project'
import { useEditorStore } from '@/stores/editorStore'

const props = defineProps<{ page: PageRow; file: ProjectFile | undefined }>()

const emit = defineEmits<{ turn: [] }>()

const editor = useEditorStore()

const showing = computed(() => props.page.pageId === editor.currentPageId)

/**
 * A page with nothing on it is still somewhere the cursor can be. Walking onto
 * one leaves no object to stand on, so its heading takes the position instead —
 * otherwise the highlight stays behind on the page just left, pointing at an
 * object that is no longer where anyone is.
 */
const here = computed(() => showing.value && editor.cursorId === null)
</script>

<style scoped>
/*
 * The tints the headings always had, mixed onto the panel's card instead of
 * laid over it: a pinned heading has rows passing underneath, and a
 * translucent one would show them through its page name.
 */
.heading-here {
  background-color: color-mix(in oklab, var(--color-accent) 50%, var(--color-card));
}
.heading-away {
  background-color: color-mix(in oklab, var(--color-secondary) 60%, var(--color-card));
}
.heading-away:hover {
  background-color: var(--color-secondary);
}
</style>
