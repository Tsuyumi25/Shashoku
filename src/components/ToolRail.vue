<template>
  <!--
    The buttons only. How wide the column is, where it sits and what it is
    bordered with belong to whoever placed it — this decides what is in it.
  -->
  <div class="flex flex-col items-center py-1 select-none">
    <template v-for="tool in CANVAS_TOOLS" :key="tool.tool">
      <div v-if="tool.opensGroup" class="rail-divider" />
      <button
        type="button"
        class="rail-btn"
        :class="[editor.tool === tool.tool && 'rail-btn-active']"
        :title="`${tool.name}（${tool.key}）${tool.hint ? `：${tool.hint}` : ''}`"
        @click="editor.setTool(tool.tool)"
      >
        <component :is="tool.icon" :size="15" />
      </button>
    </template>

    <div class="flex-1" />

    <!--
      Which of an object's two bodies is being worked on is a mode, not a tool:
      placing, moving, connecting and selecting all go on working while it is
      up, and a tool slot would have made "work on the source" and "move things"
      mutually exclusive. So it sits below the run of tools with Quick Mask.
      Which face the other body is, and the list of them, is in the bar under
      the canvas.
    -->
    <div class="rail-divider" />
    <button
      type="button"
      class="rail-btn"
      :class="[editor.textSide === 'source' && 'rail-btn-active']"
      :title="`原文／${activeName}（Shift+S）`"
      @click="editor.setTextSide(editor.textSide === 'source' ? 'translation' : 'source')"
    >
      <Languages :size="15" />
    </button>

    <!--
      Quick Mask is a mode rather than a tool, so it sits below the run of them
      with a rule between, where Photoshop puts it. It is what the brush and the
      eraser point at — the layer with it off, the selection with it on — and a
      mode reachable only by a keystroke is a mode nobody finds.
    -->
    <div class="rail-divider" />
    <button
      type="button"
      class="rail-btn"
      :class="[selection.quickMask && 'rail-btn-active']"
      title="快速遮罩（Q）"
      @click="selection.toggleQuickMask()"
    >
      <Contrast :size="15" />
    </button>

    <!--
      Not a tool but a door, parked at the rail's foot where editors keep
      their manage gear. The title bar's menu carries the same door, which is
      the way in from the views this rail does not stand in.
    -->
    <div class="rail-divider" />
    <button type="button" class="rail-btn" title="設定" @click="ui.settingsOpen = true">
      <Settings :size="15" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Contrast, Languages, Settings } from '@lucide/vue'
import { CANVAS_TOOLS } from '@/components/canvasTools'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const editor = useEditorStore()
const project = useProjectStore()
const selection = useSelectionStore()
const ui = useUiStore()

const activeName = computed(() => project.faces.find((f) => f.id === project.activeFace)?.name ?? '譯文')
</script>

<style scoped>
.rail-btn {
  display: flex;
  height: 1.75rem;
  width: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.rail-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.rail-btn-active,
.rail-btn-active:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}
.rail-divider {
  margin: 0.25rem 0;
  height: 1px;
  width: 1.25rem;
  flex-shrink: 0;
  background: var(--border);
}
</style>
