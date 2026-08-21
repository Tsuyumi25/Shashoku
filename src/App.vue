<template>
  <div class="flex h-full flex-col">
    <TitleBar />

    <div class="flex min-h-0 flex-1">
      <!--
        The window's leftmost column, and a fixed width: a sibling of the
        splitter rather than a panel in it, so it takes no part in the columns'
        arithmetic and the saved column sizes go on meaning what they meant.

        Standing rather than following the workbench. Which tool is up is
        sticky state that outlives a trip to the other views, so picking one
        from there is picking what you will come back to; and a column that
        came and went would slide everything beside it every time the view
        changed.
      -->
      <div class="flex w-9 shrink-0 flex-col border-r border-border bg-card">
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
            The editor's sidebar and the library stay mounted rather than
            swapping: the buckets hold a series read off disk, and the library
            holds a scan, and neither is worth doing again for a trip to the
            other side.
          -->
          <div v-show="ui.view === 'editor'" class="flex min-h-0 flex-1 flex-col">
            <TranslateSidebar />
          </div>
          <ProjectLibrary v-show="ui.view === 'library'" />
          <SourcePanel v-if="ui.view === 'pages'" />
          <ExportPanel v-if="ui.view === 'export'" />
        </SplitterPanel>

        <ResizeHandle />

        <SplitterPanel :order="2" :default-size="80" :min-size="40" class="flex min-w-0 flex-col">
          <!--
            The workbench stays mounted while another view is up: the canvas
            holds a view transform worth coming back to, and a font picker
            that was open should still be open. The others are the other way
            round — their thumbnails go stale the moment a page is typeset, so
            they are built fresh each time they are asked for.
          -->
          <div class="relative min-h-0 flex-1">
            <div v-show="ui.view === 'editor'" class="absolute inset-0">
              <TranslateMode />
            </div>
            <div v-if="ui.view === 'library'" class="absolute inset-0 flex flex-col">
              <Bookshelf />
            </div>
            <div v-if="ui.view === 'pages'" class="absolute inset-0">
              <ProjectManagerMode tab="source" />
            </div>
            <div v-if="ui.view === 'export'" class="absolute inset-0">
              <ProjectManagerMode tab="export" />
            </div>
          </div>
        </SplitterPanel>
      </SplitterGroup>
    </div>

    <SettingsPopup />
  </div>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import Bookshelf from '@/components/Bookshelf.vue'
import ExportPanel from '@/components/ExportPanel.vue'
import ProjectLibrary from '@/components/ProjectLibrary.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SettingsPopup from '@/components/SettingsPopup.vue'
import SourcePanel from '@/components/SourcePanel.vue'
import TitleBar from '@/components/TitleBar.vue'
import ToolRail from '@/components/ToolRail.vue'
import { useFillSelection } from '@/composables/useFillSelection'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useOpenProject } from '@/composables/useOpenProject'
import { useSelectionPixels } from '@/composables/useSelectionPixels'
import { isTypingSurface, ownsKeyboard } from '@/lib/typingSurface'
import { useConnectStore } from '@/stores/connectStore'
import { useExportStore } from '@/stores/exportStore'
import ProjectManagerMode from '@/modes/ProjectManagerMode.vue'
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
const pixels = useSelectionPixels()

// The window holds itself open until this answers, so every path out of it has
// to reach the release — a failed write loses that one write, not the reply.
window.api.onWillClose(() => {
  editor.flushTextEdit()
  void Promise.allSettled([project.flush(), preferences.flush()]).then(() =>
    window.api.windowCloseReady(),
  )
})

// All three listeners stand down while the settings panel is up: these keys
// act on the document, and the document is underneath it.
useEventListener(window, 'keydown', (e) => {
  if (ui.settingsOpen) return
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
    if (ui.view === 'pages' || ui.view === 'export') exportSelection.selectAll()
    else if (editor.maskTarget) selection.selectAll(editor.maskTarget)
    return
  }

  // A text box has its own history, and taking Ctrl+Z off it would undo some
  // earlier command while the half-typed line sat there untouched.
  if (isTypingSurface(document.activeElement)) return

  // One stack for the whole project, so the page grid answers these too — a
  // page dropped in the wrong place is the easiest thing here to do by accident
  // and the hardest to notice.
  if (ui.view === 'pages' || ui.view === 'export') {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      editor.undo()
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault()
      editor.redo()
    }
    return
  }

  if (ui.view !== 'editor') return

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
    // One key for both, as Photoshop's is: a selection means lift what is
    // inside it onto a layer of its own, and no selection means copy the whole
    // layer. Both come out as a new layer above the one they were taken from,
    // which is why they are the same key rather than two.
    e.preventDefault()
    if (e.repeat) return
    const lift = pixels.liftsSelection.value
      ? pixels.liftSelection()
      : merge.duplicateLayer()
    void lift.catch((err: unknown) => console.error('duplicate failed', err))
  }
})

/**
 * Alt+Backspace fills with the foreground colour, as in Photoshop. It sits
 * apart from the two listeners around it because they divide the keyboard by
 * whether Ctrl is held, and this key is held by neither side.
 */
useEventListener(window, 'keydown', (e) => {
  if (ui.settingsOpen) return
  if (ui.view !== 'editor' || e.key !== 'Backspace') return
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
  if (ui.settingsOpen) return
  if (ui.view !== 'editor') return
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
    /*
     * One key, three things it could mean, ordered by how small and how recent
     * each one is. No confirmation on any of them, as in every editor with an
     * undo stack behind it.
     *
     * A line being looked at goes first: it is the most transient of the three
     * and the one the connecting tool just put under attention. Then the
     * selection's pixels, whenever there is a selection over a raster layer —
     * which is Photoshop's answer to the same collision, and the reason the
     * layer panel has a button of its own for taking a layer away.
     */
    e.preventDefault()
    if (connect.eraseSelected()) return
    if (pixels.erasesPixels.value) {
      void pixels.eraseSelection().catch((err: unknown) => console.error('erase failed', err))
      return
    }
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
    ui.setView('editor')
  })
}
</script>
