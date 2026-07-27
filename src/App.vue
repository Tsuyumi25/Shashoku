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
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const ui = useUiStore()

// The window holds itself open until this answers, so every path out of it has
// to reach the release — a failed write loses that one write, not the reply.
window.api.onWillClose(() => {
  editor.flushTextEdit()
  void Promise.allSettled([project.flush(), preferences.flush()]).then(() =>
    window.api.windowCloseReady(),
  )
})

const title = computed(() => {
  if (!project.isOpen) return 'Shashoku 写植'
  const dir = project.folderPath?.split('/').pop() ?? ''
  return `${project.dirty ? '● ' : ''}${dir}`
})

useEventListener(window, 'keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return
  const key = e.key.toLowerCase()

  if (key === 's') {
    e.preventDefault()
    if (!project.isOpen) return
    // Everything already saves itself, so this only says "now" — which is
    // still worth having for the moment before handing the folder to someone
    // else. What lands on disk and what the undo stack says have to agree, so
    // an unfinished translation is banked first.
    editor.flushTextEdit()
    void project.flush().catch((err) => console.error(err))
    return
  }

  if (ui.view !== 'translate') return
  // A text box has its own history, and taking Ctrl+Z off it would undo some
  // earlier command while the half-typed line sat there untouched.
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return

  if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    editor.undo()
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault()
    editor.redo()
  }
})

// A dev build opens the project named in .env, so restarting costs no trip
// through the picker. Both failures report to the console rather than the
// screen: nothing here is reachable in a packaged build, and whoever set the
// variable is the person watching devtools. See .env.example.
const devProject = import.meta.env.DEV ? import.meta.env.RENDERER_VITE_DEV_PROJECT : undefined
if (devProject) {
  void project
    .openByPath(devProject)
    .then((opened) => {
      if (opened === null) {
        console.error(`RENDERER_VITE_DEV_PROJECT is not a Shashoku project: ${devProject}`)
        return
      }
      editor.clearHistory()
      editor.selectFile(project.files[0]?.filename ?? null)
      ui.setView('translate')
    })
    .catch((err) => console.error('RENDERER_VITE_DEV_PROJECT failed to open', err))
}
</script>
