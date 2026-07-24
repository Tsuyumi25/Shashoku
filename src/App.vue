<template>
  <div class="flex h-full flex-col">
    <Titlebar
      :is-dark="isDark"
      @toggle-theme="toggleTheme"
    />
    <main class="min-h-0 flex-1">
      <TranslateMode />
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
import { useDark } from '@vueuse/core'
import Titlebar from '@/components/Titlebar.vue'
import TranslateMode from '@/modes/TranslateMode.vue'

const isDark = useDark({ initialValue: 'light' })

function toggleTheme(e: MouseEvent) {
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
