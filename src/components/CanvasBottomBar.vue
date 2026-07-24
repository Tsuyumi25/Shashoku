<template>
  <div class="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-card px-1 select-none">
    <button class="page-btn" title="縮小">
      <ZoomOut :size="14" />
    </button>
    <button class="page-btn" title="放大">
      <ZoomIn :size="14" />
    </button>
    <span class="px-1 text-xs text-muted-foreground tabular-nums">100%</span>
    <button class="page-btn" title="適應視窗">
      <Maximize :size="13" />
    </button>

    <div class="flex-1" />

    <select class="h-5 max-w-64 min-w-0 rounded border border-input bg-background px-1 text-xs">
      <option>001.png（6）</option>
      <option>002.png</option>
      <option>003.png</option>
    </select>
    <button class="page-btn" title="上一頁">
      <ChevronLeft :size="15" />
    </button>
    <button class="page-btn" title="下一頁">
      <ChevronRight :size="15" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from '@lucide/vue'
</script>

<style scoped>
.page-btn {
  display: flex;
  height: 1.25rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.page-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
