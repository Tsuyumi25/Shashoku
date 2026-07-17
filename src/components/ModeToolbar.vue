<template>
  <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 select-none">
    <button
      v-for="m in MODES"
      :key="m.mode"
      class="flex h-7 items-center gap-1 rounded px-2 text-sm"
      :class="[
        editor.mode === m.mode
          ? 'bg-accent text-accent-foreground ring-1 ring-ring'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      ]"
      :title="m.title"
      @click="editor.mode = m.mode"
    >
      <component :is="m.icon" :size="14" />
      {{ m.text }}
    </button>

    <div class="mx-1 h-5 w-px bg-border" />

    <!-- 分組按鈕：原版彩色文字 + 選中框，1-9 快捷鍵 -->
    <button
      v-for="(group, i) in project.header.groups"
      :key="i"
      class="h-7 rounded border px-2 text-sm font-medium"
      :class="[
        editor.activeCategory === i + 1
          ? 'border-current bg-secondary/60'
          : 'border-transparent hover:bg-secondary/40',
      ]"
      :style="{ color: CATEGORY_COLORS[i] }"
      :title="`分組 ${i + 1}（快捷鍵 ${i + 1}）`"
      @click="editor.activeCategory = i + 1"
    >
      {{ group }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Eye, MousePointer2, Tag, Type } from '@lucide/vue'
import { CATEGORY_COLORS } from '@shared/ssk/constants'
import { useEditorStore, type WorkMode } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const MODES: { mode: WorkMode; text: string; title: string; icon: unknown }[] = [
  { mode: 'browse', text: '瀏覽(Q)', title: '瀏覽模式：拖曳平移、點標籤選取', icon: MousePointer2 },
  { mode: 'label', text: '標號(W)', title: '標號模式：單擊新增、右鍵刪除、拖曳移動', icon: Tag },
  { mode: 'input', text: '錄入(E)', title: '錄入模式：點標籤直接輸入翻譯', icon: Type },
  { mode: 'check', text: '檢查(R)', title: '檢查模式：畫布顯示分組、滑過即選取', icon: Eye },
]
</script>
