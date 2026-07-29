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
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          :title="showingLabels ? '改看圖層樹（本頁）' : '改看標籤清單（整章）'"
          @click="ui.togglePanel()"
        >
          <component :is="showingLabels ? List : Layers" :size="14" />
        </button>
        <span class="ml-1 text-xs font-medium text-muted-foreground">
          {{ showingLabels ? '標籤' : '圖層' }}
        </span>
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
      </div>
      <LabelList v-if="showingLabels" />
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
        <span class="text-xs font-medium text-muted-foreground">分組</span>
        <button
          type="button"
          class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          title="新增群組"
          :disabled="!project.isOpen"
          @click="onAddGroup"
        >
          <Plus :size="14" />
        </button>
      </div>
      <SplitterGroup
        direction="vertical"
        class="min-h-0 flex-1"
        auto-save-id="translate:groups"
        :storage="preferences.panelStorage"
      >
        <SplitterPanel :order="1" :default-size="45" :min-size="20" class="min-h-0">
          <GroupList />
        </SplitterPanel>
        <ResizeHandle vertical />
        <SplitterPanel :order="2" :default-size="55" :min-size="20" class="min-h-0">
          <StylePanel />
        </SplitterPanel>
      </SplitterGroup>
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Layers, List, Plus } from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import CanvasBottomBar from '@/components/CanvasBottomBar.vue'
import CanvasView from '@/components/CanvasView.vue'
import FontPickerOverlay from '@/components/FontPickerOverlay.vue'
import GroupList from '@/components/GroupList.vue'
import LabelList from '@/components/LabelList.vue'
import LayerTree from '@/components/LayerTree.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import StylePanel from '@/components/StylePanel.vue'
import { useFontPicker } from '@/composables/useFontPicker'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const ui = useUiStore()
const editor = useEditorStore()
const preferences = usePreferencesStore()
const fontPicker = useFontPicker()

const showingLabels = computed(() => ui.panel === 'labels')

// The chapter's, not the open page's — the list below spans the chapter.
const labelCount = computed(() =>
  project.files.reduce((n, f) => n + f.page.readingOrder.length, 0),
)

function onAddGroup() {
  const taken = new Set(project.header.groups.map((g) => g.name))
  let n = project.header.groups.length + 1
  while (taken.has(`群組${n}`)) n++

  const before = project.header.groups.length
  if (!editor.cmdAddGroup(`群組${n}`)) return
  const added = project.header.groups[before]
  if (added) editor.activeGroupId = added.id
}
</script>
