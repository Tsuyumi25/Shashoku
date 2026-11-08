<template>
  <div class="flex h-8 shrink-0 items-stretch border-b border-border bg-card text-xs" role="tablist">
    <button
      v-for="tab in TABS"
      :key="tab.view"
      type="button"
      role="tab"
      class="flex-1 border-b-2 px-2 transition-colors"
      :class="
        column.shown.value === tab.view
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      "
      :aria-selected="column.shown.value === tab.view"
      :title="tab.title"
      @click="column.show(tab.view)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useLeftColumn, type ColumnView } from '@/composables/useLeftColumn'

const TABS: { view: ColumnView; label: string; title: string }[] = [
  { view: 'materials', label: '素材', title: '這一話自己的文字物件，照一種排法分堆' },
  { view: 'font', label: '字型', title: '字型' },
]

const column = useLeftColumn()
</script>
