<template>
  <!-- 翻譯視圖的左側 sidebar:分組 + 顯示偏好,底部是全 app 共通的 mode 切換。
       原版的四種工作模式(瀏覽/標號/錄入/檢查)已退場:滑鼠是無模式的直接
       操作,錄入走鍵盤 modal 層,檢查歸校對 mode -->
  <aside
    class="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-2 select-none"
    style="width: var(--layout-sidebar-w)"
  >
    <div>
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

    <div class="mt-3 border-t border-border pt-2">
      <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">顯示</div>
      <button
        class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm"
        :class="
          editor.showGroups
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-secondary'
        "
        title="marker 旁常駐顯示分組名(原檢查模式的顯示效果)"
        @click="editor.showGroups = !editor.showGroups"
      >
        <Eye :size="14" />
        分組名
      </button>
    </div>

    <ModeSwitcher class="mt-auto" />
  </aside>
</template>

<script setup lang="ts">
import { Eye } from '@lucide/vue'
import { CATEGORY_COLORS } from '@shared/ssk/constants'
import ModeSwitcher from '@/components/ModeSwitcher.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()
</script>
