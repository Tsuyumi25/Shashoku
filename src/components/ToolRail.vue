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
        :class="[editor.tool === tool.tool && 'rail-btn-active', tool.inert && 'rail-btn-inert']"
        :title="tool.title"
        @click="chooseTool(tool.tool)"
      >
        <component :is="tool.icon" :size="15" />
      </button>
    </template>

    <div class="flex-1" />

    <!--
      Quick Mask is a mode rather than a tool, so it sits below the run of them
      with a rule between, where Photoshop puts it. It is still in the rail
      because the brush is inert without it, and a mode reachable only by a
      keystroke is a mode nobody finds.
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
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  CircleDashed,
  Contrast,
  Eraser,
  Lasso,
  LassoSelect,
  MousePointer2,
  Paintbrush,
  SquareDashed,
  Type,
  Wand,
} from '@lucide/vue'
import { useToolChoice } from '@/composables/useToolChoice'
import { maskBrushModeOf, useEditorStore, type CanvasTool } from '@/stores/editorStore'
import { useSelectionStore } from '@/stores/selectionStore'

const editor = useEditorStore()
const selection = useSelectionStore()
const { chooseTool } = useToolChoice()

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
  /** Up, but with nothing to act on until something else is turned on. */
  inert?: boolean
}

const tools = computed<RailTool[]>(() => [
  { tool: 'select', icon: MousePointer2, title: '選取工具（V）' },
  { tool: 'text', icon: Type, title: '文字工具（T）' },
  { tool: 'marquee-rect', icon: SquareDashed, title: '矩形選區（M）', opensGroup: true },
  { tool: 'marquee-ellipse', icon: CircleDashed, title: '橢圓選區（Shift+M）' },
  { tool: 'lasso', icon: Lasso, title: '套索（L）' },
  { tool: 'lasso-polygon', icon: LassoSelect, title: '多邊形套索（Shift+L）' },
  { tool: 'wand', icon: Wand, title: '魔術棒（W）' },
  { tool: 'brush', icon: Paintbrush, title: '遮罩筆刷（B）', inert: isInert('brush') },
  { tool: 'eraser', icon: Eraser, title: '遮罩橡皮擦（E）', inert: isInert('eraser') },
])

/**
 * Both mask tools draw only where Quick Mask can show it. Said out loud,
 * because a tool that leaves no mark reads as a broken one — and only the tool
 * that is up says it, since the others are not the ones being refused.
 */
function isInert(tool: CanvasTool): boolean {
  return editor.tool === tool && maskBrushModeOf(tool) !== null && !selection.quickMask
}
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
/* The tool is up but has nothing to draw on until Quick Mask is. */
.rail-btn-inert {
  opacity: 0.4;
}
.rail-divider {
  margin: 0.25rem 0;
  height: 1px;
  width: 1.25rem;
  flex-shrink: 0;
  background: var(--border);
}
</style>
