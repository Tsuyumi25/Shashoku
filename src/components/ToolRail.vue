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
      A right click opens the faces: which one the other body is, and the list.
    -->
    <div class="rail-divider" />
    <PopoverRoot v-model:open="facesOpen">
      <PopoverAnchor as-child>
        <button
          type="button"
          class="rail-btn"
          :class="[editor.textSide === 'source' && 'rail-btn-active']"
          :title="`原文／${activeName}（Shift+S，右鍵管理譯文面）`"
          @click="editor.setTextSide(editor.textSide === 'source' ? 'translation' : 'source')"
          @contextmenu.prevent="facesOpen = true"
        >
          <Languages :size="15" />
        </button>
      </PopoverAnchor>
      <PopoverPortal>
        <PopoverContent class="face-options" side="right" align="end" :side-offset="6">
          <div class="face-head">譯文面</div>
          <div v-for="face in project.faces" :key="face.id" class="face-row">
            <input
              type="radio"
              name="active-face"
              :checked="face.id === project.activeFace"
              title="切到這個譯文面"
              @change="editor.setActiveFace(face.id)"
            />
            <input
              class="face-name"
              :value="face.name"
              @change="onRename(face.id, $event)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <button
              type="button"
              class="face-btn"
              title="刪除這個譯文面"
              :disabled="project.faces.length <= 1"
              @click="onDelete(face.id, face.name)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <button type="button" class="face-add" title="照目前的譯文面排版，開一個空白的新譯文面" @click="onAdd">
            <Plus :size="13" /> 新增譯文面
          </button>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

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
import { computed, ref, type Component } from 'vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
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
  Plus,
  Settings,
  SprayCan,
  SquareDashed,
  Trash2,
  Type,
  Wand,
  Waypoints,
} from '@lucide/vue'
import { useEditorStore, type CanvasTool } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

const editor = useEditorStore()
const project = useProjectStore()
const selection = useSelectionStore()
const ui = useUiStore()

const facesOpen = ref(false)
const activeName = computed(() => project.faces.find((f) => f.id === project.activeFace)?.name ?? '譯文')

function onRename(id: string, e: Event): void {
  const input = e.target as HTMLInputElement
  const name = input.value.trim()
  if (name === '') {
    input.value = project.faces.find((f) => f.id === id)?.name ?? ''
    return
  }
  editor.cmdRenameFace(id, name)
}

function onDelete(id: string, name: string): void {
  if (!window.confirm(`刪除譯文面「${name}」？這一面每一頁的譯文、候選和閱讀順序都會一起刪掉。`)) return
  editor.cmdDeleteFace(id)
}

function onAdd(): void {
  editor.cmdAddFace(freeFaceName())
}

function freeFaceName(): string {
  const taken = new Set(project.faces.map((f) => f.name))
  for (let n = project.faces.length + 1; ; n++) {
    const name = `譯文 ${n}`
    if (!taken.has(name)) return name
  }
}

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
  { tool: 'tag-paint', icon: SprayCan, title: '標記畫筆（K）' },
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

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.face-options {
  z-index: 50;
  display: flex;
  width: 15rem;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 0.8125rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.face-head {
  font-size: 12px;
  color: var(--muted-foreground);
}
.face-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.face-name {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--input);
  border-radius: 0.25rem;
  background: var(--background);
  padding: 1px 4px;
}
.face-btn {
  border-radius: 0.25rem;
  padding: 2px;
  color: var(--muted-foreground);
}
.face-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.face-btn:disabled {
  opacity: 0.4;
}
.face-add {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border-radius: 0.25rem;
  padding: 2px 6px;
  color: var(--muted-foreground);
}
.face-add:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
