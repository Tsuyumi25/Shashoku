<template>
  <header
    class="flex h-9 shrink-0 items-center border-b border-border select-none"
    style="-webkit-app-region: drag"
  >
    <span class="flex-1 truncate px-3 text-center text-sm text-muted-foreground">
      Shashoku 写植
    </span>
    <div class="flex h-full" style="-webkit-app-region: no-drag">
      <button
        class="win-btn hover:bg-secondary"
        :title="isDark ? '切換亮色主題' : '切換暗色主題'"
        @click="emit('toggleTheme', $event)"
      >
        <Sun v-if="isDark" :size="14" />
        <Moon v-else :size="14" />
      </button>
      <button class="win-btn hover:bg-secondary">
        <Minus :size="14" />
      </button>
      <button class="win-btn hover:bg-secondary">
        <Square :size="12" />
      </button>
      <button class="win-btn hover:bg-destructive">
        <X :size="14" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Minus, Moon, Square, Sun, X } from '@lucide/vue'

defineProps<{ isDark: boolean }>()

const emit = defineEmits<{
  toggleTheme: [e: MouseEvent]
}>()
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
