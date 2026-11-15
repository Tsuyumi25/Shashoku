<template>
  <DialogRoot :open="ui.pageManagerOpen" @update:open="(v) => (ui.pageManagerOpen = v)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="sheet-panel" :aria-describedby="undefined" @open-auto-focus="onOpened">
        <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <DialogTitle class="text-sm font-medium">頁面</DialogTitle>
          <span class="text-xs text-muted-foreground tabular-nums">{{ project.files.length }}</span>
          <div class="flex-1" />
          <DialogClose class="sheet-close" title="關閉">
            <X :size="14" />
          </DialogClose>
        </header>

        <p v-if="project.files.length === 0" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          還沒有頁面
        </p>
        <div v-else ref="scroller" class="min-h-0 flex-1 overflow-y-auto p-3 select-none">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2">
            <PageManagerCard
              v-for="(file, index) in project.files"
              :key="file.pageId"
              :data-key="file.pageId"
              :file="file"
              :number="index + 1"
              :current="file.pageId === editor.currentPageId"
              @dblclick="openPage(file.pageId)"
            />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { X } from '@lucide/vue'
import PageManagerCard from '@/components/pageManager/PageManagerCard.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const ui = useUiStore()
const project = useProjectStore()
const editor = useEditorStore()

const scroller = ref<HTMLElement | null>(null)

function onOpened() {
  const current = editor.currentPageId
  if (current === null) return
  void nextTick(() =>
    scroller.value
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(current)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'instant' }),
  )
}

function openPage(pageId: string) {
  editor.showPage(pageId)
  ui.pageManagerOpen = false
}

watch(
  () => project.rootPath,
  () => (ui.pageManagerOpen = false),
)
</script>
