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
        <ProjectLibrary />
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

        <!--
          The translate workbench stays mounted while the project manager is
          up: the canvas holds a view transform worth coming back to, and a
          font picker that was open should still be open. The manager is the
          other way round — its thumbnails go stale the moment a page is
          typeset, so it is built fresh each time it is asked for.
        -->
        <div class="relative min-h-0 flex-1">
          <div v-show="ui.view === 'translate'" class="absolute inset-0">
            <TranslateMode />
          </div>
          <div v-if="ui.view === 'project-manager'" class="absolute inset-0">
            <ProjectManagerLayout />
          </div>
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
import ProjectLibrary from '@/components/ProjectLibrary.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SidebarHeader from '@/components/SidebarHeader.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import WindowControls from '@/components/WindowControls.vue'
import { useOpenProject } from '@/composables/useOpenProject'
import { isTypingSurface, ownsKeyboard } from '@/lib/editContext'
import { useExportStore } from '@/stores/exportStore'
import ProjectManagerLayout from '@/modes/ProjectManagerLayout.vue'
import TranslateMode from '@/modes/TranslateMode.vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const exportSelection = useExportStore()
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

  if (key === 'a') {
    // Whatever holds the caret owns this key. Anywhere else, selecting the
    // whole window's prose is a web page's idea of what it means: here it
    // either picks every page or it does nothing, but it never leaves the
    // interface highlighted blue.
    if (isTypingSurface(document.activeElement)) return
    e.preventDefault()
    if (ui.view === 'project-manager') exportSelection.selectAll()
    return
  }

  if (ui.view !== 'translate') return
  // A text box has its own history, and taking Ctrl+Z off it would undo some
  // earlier command while the half-typed line sat there untouched.
  if (isTypingSurface(document.activeElement)) return

  if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    editor.undo()
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault()
    editor.redo()
  }
})

/**
 * Keys that act on the document rather than on one surface of it, dispatched by
 * what they act on rather than by which panel has focus.
 *
 * The selection belongs to the canvas, the label list and the layer tree
 * equally, so none of them owns the keys that move it or empty it. Left and
 * right are the page; up and down are one row, whatever the open panel is
 * showing rows of.
 *
 * The only guard is whether the focused element answers the key itself — which
 * is also what makes the label list's two layers work, since a row being typed
 * into is a real input and a row merely selected is not.
 */
useEventListener(window, 'keydown', (e) => {
  if (ui.view !== 'translate') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (ownsKeyboard(document.activeElement)) return

  const byRow = (offset: number) => {
    e.preventDefault()
    if (ui.panel === 'layers') editor.selectLayerBy(offset)
    else editor.selectLabelBy(offset)
  }

  if (e.key === 'ArrowUp' || e.key === 'k') byRow(-1)
  else if (e.key === 'ArrowDown' || e.key === 'j') byRow(1)
  else if (e.key === 'ArrowLeft') editor.pageBy(-1)
  else if (e.key === 'ArrowRight') editor.pageBy(1)
  else if (e.key === 'Delete') {
    // No confirmation, as in every editor with an undo stack behind it.
    e.preventDefault()
    editor.deleteSelection()
  } else if (e.key === 'Escape' && editor.selectedIds.size > 0) {
    // Backing out one layer at a time. Marked handled so the canvas does not
    // also read this press as the first half of its double tap to fit.
    e.preventDefault()
    editor.selectOnly(null)
  }
})

// A dev build opens the project named in .env, so restarting costs no trip
// through the picker. Both failures report to the console rather than the
// screen: nothing here is reachable in a packaged build, and whoever set the
// variable is the person watching devtools. See .env.example.
const devProject = import.meta.env.DEV ? import.meta.env.RENDERER_VITE_DEV_PROJECT : undefined
if (devProject) {
  const { openPath, lastError } = useOpenProject()
  void openPath(devProject).then((opened) => {
    if (!opened) {
      console.error(
        lastError.value ?? `RENDERER_VITE_DEV_PROJECT is not a Shashoku project: ${devProject}`,
      )
      return
    }
    ui.setView('translate')
  })
}
</script>
