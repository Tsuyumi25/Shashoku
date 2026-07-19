<template>
  <!-- mode 切換(Resolve 式工序分頁,沉在每個視圖 sidebar 的最底部):
       同一份專案資料的投影,切換不丟狀態(v-show 常駐)。
       直排一維列表,與 sidebar 上方的動作按鈕同一種節奏 -->
  <nav class="flex shrink-0 flex-col gap-1 border-t border-border pt-2 select-none">
    <button
      v-for="m in MODES"
      :key="m.id"
      class="rounded px-2 py-1.5 text-left text-sm transition-colors"
      :class="
        appMode === m.id
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent text-accent-foreground hover:bg-secondary'
      "
      @click="appMode = m.id"
    >
      {{ m.label }}
    </button>
  </nav>
</template>

<script setup lang="ts">
import { appMode, type AppMode } from '@/lib/appMode'

// 工序順序:翻譯 → 嵌字 → 校對;字體是工序外的參考視圖,排最後
const MODES: { id: AppMode; label: string }[] = [
  { id: 'translate', label: '翻譯' },
  { id: 'letter', label: '嵌字' },
  { id: 'proofread', label: '校對' },
  { id: 'fonts', label: '字體' },
]
</script>
