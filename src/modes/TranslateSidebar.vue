<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
      <span class="text-xs font-medium text-muted-foreground">外觀</span>
    </div>
    <AppearancePanel class="min-h-0 flex-1" />
  </div>
</template>

<script setup lang="ts">
import AppearancePanel from '@/components/AppearancePanel.vue'

/**
 * What the selection looks like, the whole column.
 *
 * The semantic buckets used to share it. They are needed when they are needed —
 * a few times a chapter, and then wanting a lot of room — so they live in the
 * wall's own window rather than holding a third of this column the rest of
 * the time.
 */
</script>
