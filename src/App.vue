<template>
  <div class="relative flex h-full">
    <!--
      The window's leftmost column, and a fixed width: a sibling of the splitter
      rather than a panel in it, so it takes no part in the columns' arithmetic
      and the saved column sizes go on meaning what they meant.

      It starts below a strip of the title band, which runs unbroken across every
      column — a rail reaching the top edge would punch a hole in the only place
      the window can be dragged by.

      Standing rather than following the workbench. Which tool is up is sticky
      state that outlives a trip to the project manager, so picking one from
      there is picking what you will come back to; and a column that came and
      went would slide everything beside it every time the view changed.
    -->
    <div class="flex w-9 shrink-0 flex-col border-r border-border bg-card">
      <div class="h-9 shrink-0 border-b border-border" style="-webkit-app-region: drag" />
      <ToolRail class="min-h-0 flex-1" />
    </div>

    <SplitterGroup direction="horizontal" class="min-w-0 flex-1">
      <SplitterPanel
        :order="1"
        :default-size="20"
        :min-size="10"
        class="flex min-w-0 flex-col border-r border-border bg-card"
      >
        <!--
          The header stands; what is under it is whichever view is up. Both
          stay mounted rather than swapping, for the same reason the workbench
          does: the buckets hold a series read off disk, and the library holds
          a scan, and neither is worth doing again for a trip to the other side.
        -->
        <SidebarHeader />
        <div v-show="ui.view === 'translate'" class="flex min-h-0 flex-1 flex-col">
          <TranslateSidebar />
        </div>
        <ProjectLibrary v-show="ui.view === 'project-manager'" />
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
import ToolRail from '@/components/ToolRail.vue'
import WindowControls from '@/components/WindowControls.vue'
import { useFillSelection } from '@/composables/useFillSelection'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useOpenProject } from '@/composables/useOpenProject'
import { isTypingSurface, ownsKeyboard } from '@/lib/editContext'
import { useConnectStore } from '@/stores/connectStore'
import { useExportStore } from '@/stores/exportStore'
import ProjectManagerLayout from '@/modes/ProjectManagerLayout.vue'
import TranslateMode from '@/modes/TranslateMode.vue'
import TranslateSidebar from '@/modes/TranslateSidebar.vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const selection = useSelectionStore()
const connect = useConnectStore()
const preferences = usePreferencesStore()
const exportSelection = useExportStore()
const ui = useUiStore()
const fill = useFillSelection()
const merge = useMergeLayers()

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
    // picks every page, or every pixel of the open one, but it never leaves the
    // interface highlighted blue.
    if (isTypingSurface(document.activeElement)) return
    e.preventDefault()
    if (e.repeat) return
    if (ui.view === 'project-manager') exportSelection.selectAll()
    else if (editor.maskTarget) selection.selectAll(editor.maskTarget)
    return
  }

  // A text box has its own history, and taking Ctrl+Z off it would undo some
  // earlier command while the half-typed line sat there untouched.
  if (isTypingSurface(document.activeElement)) return

  // One stack for the whole project, so the page grid answers these too — a
  // page dropped in the wrong place is the easiest thing here to do by accident
  // and the hardest to notice.
  if (ui.view === 'project-manager') {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      editor.undo()
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault()
      editor.redo()
    }
    return
  }

  if (ui.view !== 'translate') return

  if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    // A half-drawn shape or an unfinished chain is tool state and not in the
    // document, so its own vertices and links are what this takes back first.
    // Reaching past one would undo whatever came before while the unfinished
    // thing sat there untouched.
    if (selection.gestureUndo() || connect.gestureUndo()) return
    editor.undo()
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault()
    if (selection.gestureRedo() || connect.gestureRedo()) return
    editor.redo()
  } else if (key === 'd') {
    e.preventDefault()
    selection.deselect()
  } else if (key === 'i' && e.shiftKey) {
    e.preventDefault()
    if (!e.repeat && editor.maskTarget) selection.invert(editor.maskTarget)
  } else if (key === 'e') {
    // One key for both, as Photoshop's is: several selected means merge those,
    // one means merge it down.
    e.preventDefault()
    if (e.repeat) return
    void merge.mergeBySelection().catch((err: unknown) => console.error('merge failed', err))
  } else if (key === 'j') {
    e.preventDefault()
    if (e.repeat) return
    void merge.duplicateLayer().catch((err: unknown) => console.error('duplicate failed', err))
  }
})

/**
 * Alt+Backspace fills with the foreground colour, as in Photoshop. It sits
 * apart from the two listeners around it because they divide the keyboard by
 * whether Ctrl is held, and this key is held by neither side.
 */
useEventListener(window, 'keydown', (e) => {
  if (ui.view !== 'translate' || e.key !== 'Backspace') return
  if (!e.altKey || e.ctrlKey || e.metaKey) return
  if (ownsKeyboard(document.activeElement)) return
  e.preventDefault()
  if (e.repeat) return
  void fill.fillSelection().catch((err: unknown) => console.error('fill failed', err))
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

  /**
   * Which list the arrows walk is whichever one is on screen. They used to be
   * dispatched by what the cursor was standing on, because both lists were up
   * at once and there was nothing else to go by — which left the case where an
   * object picked in the tree handed the arrows to the other panel. One list at
   * a time makes the question answerable, and that case disappears with it.
   */
  const byRow = (offset: number) => {
    e.preventDefault()
    if (preferences.prefs.sidePanel === 'layers') editor.selectLayerBy(offset)
    else editor.selectLabelBy(offset)
  }

  if (e.key === 'ArrowUp' || e.key === 'k') byRow(-1)
  else if (e.key === 'ArrowDown' || e.key === 'j') byRow(1)
  else if (e.key === 'ArrowLeft') editor.pageBy(-1)
  else if (e.key === 'ArrowRight') editor.pageBy(1)
  else if (e.key === 'Delete') {
    // No confirmation, as in every editor with an undo stack behind it. A line
    // being looked at goes first: it is the smaller and more transient of the
    // two, and it is the one the connecting tool just put under attention.
    e.preventDefault()
    if (connect.eraseSelected()) return
    editor.deleteSelection()
  } else if (e.key === 'Backspace' && connect.isDrawing) {
    // The same act as Ctrl+Z inside a chain.
    e.preventDefault()
    connect.gestureUndo()
  } else if (e.key === 'Backspace' && selection.isDrawing) {
    // The same act as Ctrl+Z inside a gesture, and the key GIMP and Krita both
    // use for it.
    e.preventDefault()
    selection.gestureUndo()
  } else if (e.key === 'Escape' && selection.isDrawing) {
    // Backing out one layer at a time, innermost first: a shape being drawn is
    // the most transient thing on screen. Marked handled so the canvas does not
    // also read this press as the first half of its double tap to fit.
    e.preventDefault()
    selection.cancelGesture()
  } else if (e.key === 'Escape' && connect.isDrawing) {
    // ⚠️ The whole chain goes, not its last link. Cancelling is free precisely
    // because the page was never touched, and a partial cancel would be a
    // different promise from the one that makes it free.
    e.preventDefault()
    connect.cancel()
  } else if (e.key === 'Escape' && connect.selected !== null) {
    e.preventDefault()
    connect.deselect()
  } else if (e.key === 'Escape' && editor.selectedIds.size > 0) {
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
