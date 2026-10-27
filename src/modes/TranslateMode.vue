<template>
  <div class="flex h-full min-w-0">
    <!--
      Against the canvas rather than against the window: what is armed here
      acts there, and a rail across the room from the thing it points at makes
      that a longer trip than it is.
    -->
    <div class="flex w-9 shrink-0 flex-col border-r border-border bg-card">
      <ToolRail class="min-h-0 flex-1" />
    </div>

    <SplitterGroup
      direction="horizontal"
      class="min-w-0 flex-1"
      auto-save-id="translate:columns:v2"
      :storage="preferences.panelStorage"
    >
      <SplitterPanel :order="1" :default-size="56" :min-size="25" class="flex min-w-0 flex-col">
        <section class="relative min-h-0 flex-1">
          <CanvasView />
        </section>
        <CanvasBottomBar />
      </SplitterPanel>

      <ResizeHandle />

      <SplitterPanel
        :order="2"
        :default-size="22"
        :min-size="12"
        class="flex min-w-0 flex-col border-l border-border bg-card"
        @wheel="
          onWheelTabs(
            $event,
            TABS.map((t) => t.panel),
            preferences.prefs.sidePanel,
            preferences.setSidePanel,
          )
        "
      >
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
            @pointerenter="preferences.setSidePanel(tab.panel)"
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
            title="複製圖層；有選區時拷貝選區內容成新圖層（Ctrl+J）"
            :disabled="!canDuplicate && !pixels.liftsSelection.value"
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
          <!--
            Delete used to be the only way to take a layer away, and it now
            answers to the selection's pixels first — as it does in Photoshop,
            which has this button for the same reason. Without it, deleting a
            layer would mean deselecting first.
          -->
          <button
            type="button"
            class="panel-action ml-auto"
            title="刪除圖層（Delete，沒有選區時）"
            :disabled="editor.selectedIds.size === 0"
            @click="editor.deleteSelection()"
          >
            <Trash2 :size="14" />
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

      <ResizeHandle />

      <SplitterPanel
        :order="3"
        :default-size="22"
        :min-size="12"
        class="flex min-w-0 flex-col border-l border-border bg-card"
      >
        <TranslateSidebar />
      </SplitterPanel>
    </SplitterGroup>
  </div>
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
  Trash2,
} from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import CanvasView from '@/components/CanvasView.vue'
import LabelList from '@/components/LabelList.vue'
import LayerTree from '@/components/LayerTree.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import ToolRail from '@/components/ToolRail.vue'
import TranslateSidebar from '@/modes/TranslateSidebar.vue'
import { useFillSelection } from '@/composables/useFillSelection'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useSelectionPixels } from '@/composables/useSelectionPixels'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { allEntries, pathOf } from '@shared/page/tree'
import type { SidePanel } from '@shared/preferences/types'
import { nextAutoName } from '@/lib/autoName'
import { onWheelTabs } from '@/lib/wheelTabs'

const TABS: { panel: SidePanel; title: string }[] = [
  { panel: 'layers', title: '圖層' },
  { panel: 'labels', title: '標籤' },
]

const project = useProjectStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const { canFill, fillSelection } = useFillSelection()
const { canMerge, canDuplicate, mergeBySelection, duplicateLayer } = useMergeLayers()
const pixels = useSelectionPixels()

function onFill() {
  void fillSelection().catch((err: unknown) => console.error('fill failed', err))
}

function onMerge() {
  void mergeBySelection().catch((err: unknown) => console.error('merge failed', err))
}

// The same fork the key takes, so the button and Ctrl+J cannot come to mean
// two different things.
function onDuplicate() {
  const copy = pixels.liftsSelection.value ? pixels.liftSelection() : duplicateLayer()
  void copy.catch((err: unknown) => console.error('duplicate failed', err))
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
    effects: [],
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

</script>

<style scoped>
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
