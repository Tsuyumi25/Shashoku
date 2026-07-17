<template>
  <!-- mode 切換(Resolve 式工序分頁,沉在每個視圖 sidebar 的最底部):
       同一份專案資料的兩種投影,切換不丟狀態(v-show 常駐) -->
  <nav class="grid shrink-0 grid-cols-2 gap-1 border-t border-border pt-2 select-none">
    <button
      v-for="m in MODES"
      :key="m.id"
      class="rounded-md px-2 py-1.5 text-xs transition-colors"
      :class="
        appMode === m.id
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      "
      @click="appMode = m.id"
    >
      {{ m.label }}
    </button>
  </nav>
</template>

<script setup lang="ts">
import { appMode, type AppMode } from '@/lib/appMode'

const MODES: { id: AppMode; label: string }[] = [
  { id: 'translate', label: '翻譯' },
  { id: 'letter', label: '嵌字' },
]
</script>
