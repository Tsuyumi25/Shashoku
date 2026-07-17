<template>
  <!-- 翻譯視圖的左側 sidebar:工作模式 + 分組,底部是全 app 共通的 mode 切換 -->
  <aside
    class="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-2 select-none"
    style="width: var(--layout-sidebar-w)"
  >
    <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">工作模式</div>
    <button
      v-for="m in WORK_MODES"
      :key="m.mode"
      class="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm"
      :class="
        editor.mode === m.mode
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent text-accent-foreground hover:bg-secondary'
      "
      :title="m.title"
      @click="editor.mode = m.mode"
    >
      <span class="flex items-center gap-1.5">
        <component :is="m.icon" :size="14" />
        {{ m.text }}
      </span>
      <kbd class="text-[10px] opacity-60">{{ m.key }}</kbd>
    </button>

    <div class="mt-3 border-t border-border pt-2">
      <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">分組</div>
      <button
        v-for="(group, i) in project.header.groups"
        :key="i"
        class="flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm font-medium"
        :class="
          editor.activeCategory === i + 1
            ? 'border-current bg-secondary/60'
            : 'border-transparent hover:bg-secondary/40'
        "
        :style="{ color: CATEGORY_COLORS[i] }"
        :title="`分組 ${i + 1}（快捷鍵 ${i + 1}）`"
        @click="editor.activeCategory = i + 1"
      >
        <span class="truncate">{{ group }}</span>
        <kbd class="text-[10px] opacity-60">{{ i + 1 }}</kbd>
      </button>
    </div>

    <ModeSwitcher class="mt-auto" />
  </aside>
</template>

<script setup lang="ts">
import { Eye, MousePointer2, Tag, Type } from '@lucide/vue'
import { CATEGORY_COLORS } from '@shared/ssk/constants'
import ModeSwitcher from '@/components/ModeSwitcher.vue'
import { useEditorStore, type WorkMode } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const WORK_MODES: { mode: WorkMode; text: string; key: string; title: string; icon: unknown }[] = [
  { mode: 'browse', text: '瀏覽', key: 'Q', title: '瀏覽模式：拖曳平移、點標籤選取', icon: MousePointer2 },
  { mode: 'label', text: '標號', key: 'W', title: '標號模式：單擊新增、右鍵刪除、拖曳移動', icon: Tag },
  { mode: 'input', text: '錄入', key: 'E', title: '錄入模式：點標籤直接輸入翻譯', icon: Type },
  { mode: 'check', text: '檢查', key: 'R', title: '檢查模式：畫布顯示分組、滑過即選取', icon: Eye },
]
</script>
