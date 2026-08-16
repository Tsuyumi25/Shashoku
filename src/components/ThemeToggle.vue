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
import { nextTick, watch } from 'vue'
import { useDark } from '@vueuse/core'
import { Moon, Sun } from '@lucide/vue'

const isDark = useDark({ initialValue: 'light' })

// Hex mirrors of --card / --muted-foreground in index.css: the window buttons
// are painted by Chromium outside the DOM, so they cannot read CSS variables
// and have to be handed resolved colors.
const OVERLAY = {
  dark: { color: '#2c2c2b', symbolColor: '#b7b5a9' },
  light: { color: '#f5f4ef', symbolColor: '#6e6d68' },
}

watch(
  isDark,
  (dark) => {
    const { color, symbolColor } = OVERLAY[dark ? 'dark' : 'light']
    window.api.windowSetOverlay(color, symbolColor)
  },
  { immediate: true },
)

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
/* The app's own button idiom, as the hamburger wears — not the system
   buttons' shape, which differs per platform (GNOME circles, Windows
   full-height rectangles). */
.theme-btn {
  display: flex;
  height: 1.75rem;
  width: 1.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  margin-right: 0.375rem;
  color: var(--muted-foreground);
}
.theme-btn:hover {
  color: var(--foreground);
}
</style>
