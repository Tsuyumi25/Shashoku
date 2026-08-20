<template>
  <SplitterGroup
    direction="horizontal"
    class="h-full"
    auto-save-id="translate:columns:three"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="56" :min-size="25" class="flex min-w-0 flex-col">
      <section class="relative min-h-0 flex-1">
        <CanvasView />
        <div
          v-show="fontPicker.isOpen.value"
          class="absolute inset-0 z-10 transition-opacity duration-150"
          :class="fontPicker.previewFace.value !== null ? 'opacity-0' : ''"
        >
          <FontPickerOverlay />
        </div>
      </section>
      <CanvasBottomBar />
    </SplitterPanel>

    <ResizeHandle />

    <!--
      Where the candidates live — what has been read off this page, what it might
      be translated as, what a model is proposing. All of them are about the
      artwork rather than about the document, which is why they stand beside the
      canvas: an entry here names a place on the page, and the list is ordered
      by measurements taken there. A column away and that cause is invisible.
    -->
    <!--
      Each row as tall as somebody dragged it, and the column scrolls when the
      rows come to more than it — the arrangement VS Code arrived at for the
      same shape (microsoft/vscode#64188, closed by making the splitview
      itself scroll).

      ⭐ What it is not is rows squeezed to share a fixed column height. That
      way the row below is wherever the row above happens to end, so it moves
      whenever anything changes; and rows crushed to their minimum leave what
      is under them undiscoverable, which Baymard's testing puts down to an
      inner scrollbar being invisible until hovered — cropped reads as absent.

      It is also what the folding rule needs. A row folded away leaves its
      head where it stands only because the row above it cannot grow into the
      space: its height is its own.
    -->
    <SplitterPanel
      :order="2"
      :default-size="22"
      :min-size="12"
      class="flex min-w-0 flex-col overflow-y-auto border-l border-border bg-card"
    >
      <SourceCandidates />
      <TranslationCandidates />
    </SplitterPanel>

    <ResizeHandle />

    <SplitterPanel
      :order="3"
      :default-size="22"
      :min-size="12"
      class="flex min-w-0 flex-col bg-card"
    >
      <SplitterGroup
        direction="vertical"
        class="min-h-0 flex-1"
        auto-save-id="translate:side"
        :storage="preferences.panelStorage"
      >
        <SplitterPanel :order="1" :default-size="30" :min-size="12" class="flex min-h-0 flex-col">
          <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2 select-none">
            <span class="text-xs font-medium text-muted-foreground">標記</span>
            <button
              type="button"
              class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title="新增標記"
              :disabled="!project.isOpen"
              @click="onAddTag"
            >
              <Plus :size="14" />
            </button>
          </div>
          <TagList class="min-h-0 flex-1" />
        </SplitterPanel>

        <ResizeHandle vertical />

        <SplitterPanel :order="2" :default-size="70" :min-size="20" class="flex min-h-0 flex-col">
          <!--
            The two of them where a title used to stand, each taking half the
            width. A title says what a panel is; two of them say that and what
            the other one is, in the same row — the column is the thing being
            short of room, so a switch is not allowed to cost a row of its own.
          -->
          <div class="flex h-7 shrink-0 select-none">
            <button
              v-for="tab in TABS"
              :key="tab.panel"
              type="button"
              class="side-tab"
              :class="preferences.prefs.sidePanel === tab.panel && 'side-tab-active'"
              @click="preferences.setSidePanel(tab.panel)"
            >
              {{ tab.title }}
            </button>
          </div>

          <!--
            What the panel showing can do, on a row of its own. Sharing the tab
            row would leave the two tabs fighting five buttons for the width,
            and the width is what tells them apart.
          -->
          <div
            v-if="preferences.prefs.sidePanel === 'layers'"
            class="flex h-7 shrink-0 items-center gap-px border-b border-border px-1 select-none"
          >
            <button
              type="button"
              class="panel-action"
              title="用前景色填充選區，寫進當前圖層（Alt+Backspace）"
              :disabled="!canFill"
              @click="onFill"
            >
              <PaintBucket :size="14" />
            </button>
            <button
              type="button"
              class="panel-action"
              title="新增圖層"
              :disabled="!editor.currentPageId"
              @click="onAddLayer"
            >
              <FilePlus :size="14" />
            </button>
            <button
              type="button"
              class="panel-action"
              title="複製圖層（Ctrl+J）"
              :disabled="!canDuplicate"
              @click="onDuplicate"
            >
              <Copy :size="14" />
            </button>
            <button
              type="button"
              class="panel-action"
              title="合併圖層（Ctrl+E）。只吃點陣圖層，以及整包都是點陣的資料夾"
              :disabled="!canMerge"
              @click="onMerge"
            >
              <Combine :size="14" />
            </button>
            <button
              type="button"
              class="panel-action"
              title="新增資料夾"
              :disabled="!editor.currentPageId"
              @click="onAddFolder"
            >
              <FolderPlus :size="14" />
            </button>
          </div>
          <div
            v-else
            class="flex h-7 shrink-0 items-center gap-px border-b border-border px-1 select-none"
          >
            <span class="ml-1 text-xs text-muted-foreground">{{ labelCount }} 條</span>
            <button
              type="button"
              class="panel-action ml-auto"
              title="在畫面中心新增標籤"
              :disabled="!editor.currentPageId"
              @click="editor.addLabelAtViewCenter()"
            >
              <Plus :size="14" />
            </button>
          </div>

          <!--
            Only the one showing is mounted. The list registers a window
            shortcut for its search box, and one left listening while hidden
            would put the caret somewhere nobody can see.
          -->
          <LayerTree v-if="preferences.prefs.sidePanel === 'layers'" class="min-h-0 flex-1" />
          <LabelList v-else class="min-h-0 flex-1" />
        </SplitterPanel>
      </SplitterGroup>
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Combine,
  Copy,
  FilePlus,
  FolderPlus,
  PaintBucket,
  Plus,
} from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import CanvasView from '@/components/CanvasView.vue'
import SourceCandidates from '@/components/SourceCandidates.vue'
import TranslationCandidates from '@/components/TranslationCandidates.vue'
import FontPickerOverlay from '@/components/FontPickerOverlay.vue'
import TagList from '@/components/TagList.vue'
import LabelList from '@/components/LabelList.vue'
import LayerTree from '@/components/LayerTree.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { useFillSelection } from '@/composables/useFillSelection'
import { useFontPicker } from '@/composables/useFontPicker'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { allEntries, pathOf } from '@shared/page/tree'
import type { SidePanel } from '@shared/preferences/types'
import { nextAutoName } from '@/lib/autoName'

const TABS: { panel: SidePanel; title: string }[] = [
  { panel: 'layers', title: '圖層' },
  { panel: 'labels', title: '標籤' },
]

const project = useProjectStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const fontPicker = useFontPicker()
const { canFill, fillSelection } = useFillSelection()
const { canMerge, canDuplicate, mergeBySelection, duplicateLayer } = useMergeLayers()

function onFill() {
  void fillSelection().catch((err: unknown) => console.error('fill failed', err))
}

function onMerge() {
  void mergeBySelection().catch((err: unknown) => console.error('merge failed', err))
}

function onDuplicate() {
  void duplicateLayer().catch((err: unknown) => console.error('duplicate failed', err))
}

// The chapter's, not the open page's — the list below spans the chapter.
const labelCount = computed(() =>
  project.files.reduce((n, f) => n + f.page.readingOrder.length, 0),
)

/** The names already spoken for on the open page, among one kind of entry. */
function takenNames(kind: 'group' | 'raster'): Set<string> {
  const page = editor.currentPageId
    ? project.pageById(editor.currentPageId)?.page
    : undefined
  return new Set(
    (page ? allEntries(page.layers) : [])
      .filter((e) => e.kind === kind)
      .map((e) => (e as GroupLayerEntry | RasterLayerEntry).name),
  )
}

function onAddFolder() {
  if (!editor.currentPageId) return
  editor.cmdAddFolder(editor.currentPageId, nextAutoName(takenNames('group'), '資料夾'))
}

/**
 * A blank layer, above whatever the cursor is on — where every panel puts a new
 * one. It has no frame and no file behind it yet; the first write places both.
 */
function onAddLayer() {
  const page = editor.currentPageId
  if (!page) return
  const file = project.pageById(page)
  if (!file) return

  const id = generateId()
  const layer: RasterLayerEntry = {
    kind: 'raster',
    id,
    name: nextAutoName(takenNames('raster'), '圖層'),
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    alphaLocked: false,
  }

  const path = editor.cursorId ? pathOf(file.page.layers, editor.cursorId) : null
  const at =
    path === null ? undefined : [...path.slice(0, -1), path[path.length - 1] + 1]
  editor.cmdAddRasterLayer(page, layer, at)
}

function onAddTag() {
  const taken = new Set(project.header.tags.map((t) => t.name))
  editor.cmdAddTag(nextAutoName(taken, '標記'))
}
</script>

<style scoped>
/*
 * Each tab takes half the width, so which one is up is readable from the shape
 * of the row before any colour is compared. The active one carries the panel's
 * own background up to its edge and drops the rule under it, which is what
 * makes the tab and the list below read as one surface rather than two.
 */
.side-tab {
  flex: 1 1 0;
  min-width: 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted-foreground);
}
.side-tab:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.side-tab-active,
.side-tab-active:hover {
  border-bottom-color: transparent;
  background: transparent;
  color: var(--foreground);
  box-shadow: inset 0 -2px 0 var(--primary);
}

.panel-action {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.panel-action:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.panel-action:disabled {
  opacity: 0.4;
}
</style>
