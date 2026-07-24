<template>
  <div class="flex h-full shrink-0" style="-webkit-app-region: no-drag">
    <button class="win-btn hover:bg-secondary" title="最小化" @click="minimize">
      <Minus :size="14" />
    </button>
    <button class="win-btn hover:bg-secondary" title="最大化" @click="maximize">
      <Square :size="12" />
    </button>
    <button class="win-btn hover:bg-destructive hover:text-destructive-foreground" title="關閉" @click="close">
      <X :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Minus, Square, X } from '@lucide/vue'

function minimize() { window.api.windowMinimize() }
function maximize() { window.api.windowMaximize() }
function close() { window.api.windowClose() }
</script>

<style scoped>
.win-btn {
  display: flex;
  height: 100%;
  width: 2.75rem;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}
.win-btn:hover {
  color: var(--foreground);
}
</style>
