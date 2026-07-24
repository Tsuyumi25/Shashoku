<template>
  <div class="relative h-full">
    <SplitterGroup direction="horizontal" class="h-full">
      <SplitterPanel
        :order="1"
        :default-size="20"
        :min-size="10"
        class="flex min-w-0 flex-col border-r border-border bg-card"
      >
        <SidebarHeader />
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <div class="px-1 text-xs text-muted-foreground">Sidebar</div>
        </div>
      </SplitterPanel>

      <ResizeHandle />

      <SplitterPanel :order="2" :default-size="80" :min-size="40" class="flex min-w-0 flex-col">
        <div
          class="flex h-9 shrink-0 items-center justify-end border-b border-border select-none"
          style="-webkit-app-region: drag"
        >
          <ThemeToggle />
          <WindowControls />
        </div>

        <div class="min-h-0 flex-1">
          <TranslateMode />
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-center px-3"
    >
      <span class="truncate text-sm text-muted-foreground">{{ title }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SidebarHeader from '@/components/SidebarHeader.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import WindowControls from '@/components/WindowControls.vue'
import TranslateMode from '@/modes/TranslateMode.vue'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()

const title = computed(() => {
  if (!project.isOpen) return 'Shashoku 写植'
  const dir = project.folderPath?.split('/').pop() ?? ''
  return `${project.dirty ? '● ' : ''}${dir}`
})

useEventListener(window, 'keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (project.isOpen) void project.save().catch((err) => console.error(err))
  }
})
</script>
