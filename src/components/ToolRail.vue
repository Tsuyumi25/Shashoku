<template>
  <!--
    The buttons only. How wide the column is, where it sits and what it is
    bordered with belong to whoever placed it — this decides what is in it.
  -->
  <div class="flex flex-col items-center py-1 select-none">
    <template v-for="tool in tools" :key="tool.tool">
      <div v-if="tool.opensGroup" class="rail-divider" />
      <button
        type="button"
        class="rail-btn"
        :class="[editor.tool === tool.tool && 'rail-btn-active']"
        :title="tool.title"
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
    -->
    <div class="rail-divider" />
    <button
      type="button"
      class="rail-btn"
      :class="[editor.textSide === 'source' && 'rail-btn-active']"
      title="原文模式（Shift+S）"
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
import { computed, type Component } from 'vue'
import {
  CircleDashed,
  Contrast,
  Eraser,
  Languages,
  Lasso,
  LassoSelect,
  MousePointer2,
  MousePointerClick,
  Paintbrush,
  Settings,
  SquareDashed,
  Type,
  Wand,
  Waypoints,
} from '@lucide/vue'
import { useEditorStore, type CanvasTool } from '@/stores/editorStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const editor = useEditorStore()
const selection = useSelectionStore()
const ui = useUiStore()

/**
 * Every tool visible at once, rather than Photoshop's stacked slots with a
 * fly-out. That fly-out exists because Photoshop has seventy tools and one
 * column; eight fit, and a tool one click away beats a tool one press-and-hold
 * away. The pairs still share their key, so `M` and `Shift+M` reach the two
 * marquees whichever is showing.
 */
interface RailTool {
  tool: CanvasTool
  icon: Component
  title: string
  /** Draws a rule above this one, so order and grouping are one list to read. */
  opensGroup?: boolean
}

const tools = computed<RailTool[]>(() => [
  { tool: 'select', icon: MousePointer2, title: '選取工具（V）' },
  { tool: 'select-text', icon: MousePointerClick, title: '文字選取工具（Shift+V）' },
  { tool: 'text', icon: Type, title: '文字工具（T）' },
  { tool: 'connect', icon: Waypoints, title: '閱讀順序連線（C）' },
  { tool: 'marquee-rect', icon: SquareDashed, title: '矩形選區（M）', opensGroup: true },
  { tool: 'marquee-ellipse', icon: CircleDashed, title: '橢圓選區（Shift+M）' },
  { tool: 'lasso', icon: Lasso, title: '套索（L）' },
  { tool: 'lasso-polygon', icon: LassoSelect, title: '多邊形套索（Shift+L）' },
  { tool: 'wand', icon: Wand, title: '魔術棒（W）' },
  { tool: 'brush', icon: Paintbrush, title: '筆刷（B）' },
  { tool: 'eraser', icon: Eraser, title: '橡皮擦（E）' },
])
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
