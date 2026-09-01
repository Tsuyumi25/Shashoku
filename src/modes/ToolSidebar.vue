<template>
  <SplitterGroup
    direction="vertical"
    class="min-h-0 flex-1"
    auto-save-id="translate:tools:v1"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="30" :min-size="10" class="flex min-h-0 flex-col">
      <div
        class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-2 select-none"
      >
        <span class="text-xs font-medium text-muted-foreground">子工具</span>
        <button
          v-if="painting"
          type="button"
          class="cell-action ml-auto"
          title="新增標記"
          :disabled="!project.isOpen"
          @click="onAddTag"
        >
          <Plus :size="14" />
        </button>
      </div>
      <!--
        The cell belongs to whichever tool is up, and only one of them has
        anything to put in it. Empty says that plainly; a list left standing
        from the tool before would be answering for a tool nobody is holding.
      -->
      <SubToolPalette v-if="painting" class="min-h-0 flex-1" />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="45" :min-size="15" class="flex min-h-0 flex-col">
      <ToolBoard />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="3" :default-size="25" :min-size="10" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">色環</span>
      </div>
      <ColorWheel class="min-h-0 flex-1" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from '@lucide/vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import ColorWheel from '@/components/ColorWheel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SubToolPalette from '@/components/SubToolPalette.vue'
import ToolBoard from '@/modes/ToolBoard.vue'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { nextAutoName } from '@/lib/autoName'

const preferences = usePreferencesStore()
const project = useProjectStore()
const editor = useEditorStore()

const painting = computed(() => editor.tool === 'tag-paint')

function onAddTag() {
  const taken = new Set(project.header.tags.map((t) => t.name))
  editor.cmdAddTag(nextAutoName(taken, '標記'))
}
</script>

<style scoped>
.cell-action {
  display: flex;
  height: 1.25rem;
  width: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.cell-action:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.cell-action:disabled {
  opacity: 0.4;
}
</style>
