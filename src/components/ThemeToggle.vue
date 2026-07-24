<template>
  <button
    class="theme-btn hover:bg-secondary"
    :title="isDark ? '切換亮色主題' : '切換暗色主題'"
    style="-webkit-app-region: no-drag"
    @click="toggle"
  >
    <Sun v-if="isDark" :size="14" />
    <Moon v-else :size="14" />
  </button>
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
import { useDark } from '@vueuse/core'
import { Moon, Sun } from '@lucide/vue'

const isDark = useDark({ initialValue: 'light' })

function toggle(e: MouseEvent) {
  if (!document.startViewTransition) {
    isDark.value = !isDark.value
    return
  }
  const x = e.clientX
  const y = e.clientY
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const transition = document.startViewTransition(async () => {
    isDark.value = !isDark.value
    await nextTick()
  })
  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 450,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      },
    )
  })
}
</script>

<style scoped>
.theme-btn {
  display: flex;
  height: 100%;
  width: 2.75rem;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}
.theme-btn:hover {
  color: var(--foreground);
}
</style>
