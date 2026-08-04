<template>
  <SplitterGroup
    direction="horizontal"
    class="h-full"
    auto-save-id="translate:columns"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="50" :min-size="25" class="flex min-w-0 flex-col">
      <section class="relative min-h-0 flex-1">
        <CanvasView />
        <div v-show="fontPicker.isOpen.value" class="absolute inset-0 z-10">
          <FontPickerOverlay />
        </div>
      </section>
      <CanvasBottomBar />
    </SplitterPanel>

    <ResizeHandle />

    <SplitterPanel
      :order="2"
      :default-size="25"
      :min-size="12"
      class="flex min-w-0 flex-col bg-card"
    >
      <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-1 select-none">
        <button
          v-for="choice in panelChoices"
          :key="choice.panel"
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded hover:bg-secondary hover:text-foreground"
          :class="ui.panel === choice.panel ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
          :title="choice.title"
          @click="ui.setPanel(choice.panel)"
        >
          <component :is="choice.icon" :size="14" />
        </button>
        <span v-if="showingLabels" class="ml-auto text-xs text-muted-foreground">
          {{ labelCount }} 條
        </span>
        <button
          v-if="showingLabels"
          type="button"
          class="ml-1 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="在畫面中心新增標籤"
          :disabled="!editor.currentFilename"
          @click="editor.addLabelAtViewCenter()"
        >
          <Plus :size="14" />
        </button>
        <button
          v-if="!showingLabels"
          type="button"
          class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="用前景色填充選區，成為新的圖層（Alt+Backspace）"
          :disabled="!canFill"
          @click="onFill"
        >
          <PaintBucket :size="14" />
        </button>
        <button
          v-if="!showingLabels"
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="新增圖層"
          :disabled="!editor.currentFilename"
          @click="onAddLayer"
        >
          <FilePlus :size="14" />
        </button>
        <button
          v-if="!showingLabels"
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="複製圖層（Ctrl+J）"
          :disabled="!canDuplicate"
          @click="onDuplicate"
        >
          <Copy :size="14" />
        </button>
        <button
          v-if="!showingLabels"
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="合併圖層（Ctrl+E）。只吃點陣圖層，以及整包都是點陣的資料夾"
          :disabled="!canMerge"
          @click="onMerge"
        >
          <Combine :size="14" />
        </button>
        <button
          v-if="!showingLabels"
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="新增資料夾"
          :disabled="!editor.currentFilename"
          @click="onAddFolder"
        >
          <FolderPlus :size="14" />
        </button>
      </div>
      <LabelList v-if="showingLabels" />
      <BucketList v-else-if="ui.panel === 'buckets'" />
      <LayerTree v-else />
    </SplitterPanel>

    <ResizeHandle />

    <SplitterPanel
      :order="3"
      :default-size="25"
      :min-size="12"
      class="flex min-w-0 flex-col bg-card"
    >
      <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">標記</span>
        <button
          type="button"
          class="ml-auto flex h-5 w-5 items-center justify-center rounded hover:bg-secondary"
          :class="editor.showTags ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          title="在畫布上顯示語意（文字選取工具下才畫）"
          @click="editor.showTags = !editor.showTags"
        >
          <Eye :size="14" />
        </button>
        <button
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="新增標記"
          :disabled="!project.isOpen"
          @click="onAddTag"
        >
          <Plus :size="14" />
        </button>
      </div>
      <SplitterGroup
        direction="vertical"
        class="min-h-0 flex-1"
        auto-save-id="translate:tags"
        :storage="preferences.panelStorage"
      >
        <SplitterPanel :order="1" :default-size="45" :min-size="20" class="min-h-0">
          <TagList />
        </SplitterPanel>
        <ResizeHandle vertical />
        <SplitterPanel :order="2" :default-size="55" :min-size="20" class="flex min-h-0 flex-col">
          <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
            <span class="text-xs font-medium text-muted-foreground">文字樣式</span>
          </div>
          <LabelStyleEditor class="min-h-0 flex-1" />
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
  Eye,
  FilePlus,
  FolderPlus,
  Layers,
  List,
  Boxes,
  PaintBucket,
  Plus,
} from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import CanvasView from '@/components/CanvasView.vue'
import FontPickerOverlay from '@/components/FontPickerOverlay.vue'
import TagList from '@/components/TagList.vue'
import BucketList from '@/components/BucketList.vue'
import LabelList from '@/components/LabelList.vue'
import LabelStyleEditor from '@/components/LabelStyleEditor.vue'
import LayerTree from '@/components/LayerTree.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { useFillSelection } from '@/composables/useFillSelection'
import { useFontPicker } from '@/composables/useFontPicker'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore, type WorkbenchPanel } from '@/stores/uiStore'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { allEntries, pathOf } from '@shared/page/tree'
import { nextAutoName } from '@/lib/autoName'

const project = useProjectStore()
const ui = useUiStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const fontPicker = useFontPicker()
const { canFill, fillSelection } = useFillSelection()
const { canMerge, canDuplicate, mergeBySelection, duplicateLayer } = useMergeLayers()

const showingLabels = computed(() => ui.panel === 'labels')

const panelChoices = [
  { panel: 'labels', icon: List, title: '標籤清單（整章）' },
  { panel: 'layers', icon: Layers, title: '圖層樹（本頁）' },
  { panel: 'buckets', icon: Boxes, title: '按語意分堆' },
] as const satisfies readonly { panel: WorkbenchPanel; icon: unknown; title: string }[]

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
  const page = editor.currentFilename
    ? project.fileByName(editor.currentFilename)?.page
    : undefined
  return new Set(
    (page ? allEntries(page.layers) : [])
      .filter((e) => e.kind === kind)
      .map((e) => (e as GroupLayerEntry | RasterLayerEntry).name),
  )
}

function onAddFolder() {
  if (!editor.currentFilename) return
  editor.cmdAddFolder(editor.currentFilename, nextAutoName(takenNames('group'), '資料夾'))
}

/**
 * A blank layer, above whatever the cursor is on — where every panel puts a new
 * one. It has no frame and no file behind it yet; the first write places both.
 */
function onAddLayer() {
  const page = editor.currentFilename
  if (!page) return
  const file = project.fileByName(page)
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
